const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let players = [];
let winOrder = [];

let deck = [];
let fieldCards = [];
let discardPile = []; // 捨て札
let currentTurnIndex = 0;
let isRevolution = false;

// ★★★ ここに追加してください！ ★★★
let exchangePending = {}; // カード交換の状態を管理する箱

let passCount = 0;
let ruleState = {
    elevenEffect: false,
    twelveBanNum: null,
};

// カード生成
function createDeck() {
    const suits = ['S', 'H', 'D', 'C'];
    let newDeck = [];
    for (let s of suits) {
        for (let i = 1; i <= 13; i++) newDeck.push({ suit: s, rank: i });
    }
    // Jokerはランク14, 15として扱う
    newDeck.push({ suit: 'Joker', rank: 14 });
    newDeck.push({ suit: 'Joker', rank: 15 });
    return shuffle(newDeck);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ★判定ロジック1: カードの「強さ」を数値化する
function getCardStrength(rank) {
    // Jokerは常に最強クラス
    if (rank === 14 || rank === 15) return 99;

    // 通常時: 3=3, ..., 13=13, 1=14, 2=15
    let str = rank;
    if (rank === 1) str = 14;
    if (rank === 2) str = 15;

    // 革命時: 強さを反転させる（Joker以外）
    if (isRevolution) {
        // 3(3) -> 15, 2(15) -> 3 のように変換
        // 計算式: 18 - 元の強さ (例: 18 - 3 = 15, 18 - 15 = 3)
        return 18 - str;
    }
    return str;
}

// ★判定ロジック2: 出せるかどうかのチェック（審判）
function isValidMove(selectedCards, fieldCards) {
    // 0枚出しは不可
    if (selectedCards.length === 0) return { valid: false, msg: "カードを選んでください" };

    // --- 手札内での整合性チェック ---
    // 出すカードが複数枚の場合、Jokerを含めて「同じ数字」として扱えるか？
    // 例: [3, 3] OK, [3, Joker] OK, [3, 4] NG
    
    // Joker以外のカードを探す
    const nonJokers = selectedCards.filter(c => c.rank !== 14 && c.rank !== 15);
    
    // 全てJokerならOK
    if (nonJokers.length > 0) {
        const baseRank = nonJokers[0].rank;
        // Joker以外のカードが全て同じランクか確認
        const isSameRank = nonJokers.every(c => c.rank === baseRank);
        if (!isSameRank) return { valid: false, msg: "違う数字は同時に出せません" };
    }

    // --- 場との比較チェック ---
    // 場にカードがないなら、なんでも出せる（整合性さえあれば）
    if (fieldCards.length === 0) return { valid: true };

    // 1. 枚数チェック
    if (selectedCards.length !== fieldCards.length) {
        return { valid: false, msg: `${fieldCards.length}枚出されています` };
    }

    // 2. 強さチェック
    // 比較のために、それぞれの「代表の強さ」を取得
    // Joker混じりの場合、数字カードの強さを採用。全部JokerならJokerの強さ。
    
    // 場の強さ
    const fieldNonJokers = fieldCards.filter(c => c.rank !== 14 && c.rank !== 15);
    const fieldRank = fieldNonJokers.length > 0 ? fieldNonJokers[0].rank : 14; 
    const fieldStr = getCardStrength(fieldRank);

    // 出すカードの強さ
    const myRank = nonJokers.length > 0 ? nonJokers[0].rank : 14;
    const myStr = getCardStrength(myRank);

    // 同じ強さは出せない（階段やしばりは今回考慮せず、シンプルに「より強い」こと）
    if (myStr <= fieldStr) {
        return { valid: false, msg: "場より強いカードを出してください" };
    }

    // ここまでクリアしたらOK
    return { valid: true };
}


io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        if (players.length >= 5) {
            socket.emit('errorMsg', '満員です');
            return;
        }
        players.push({ id: socket.id, name: name, hand: [] });
        io.emit('updatePlayers', players);
    });

   // ゲーム開始
    // ゲーム開始（階級システム＆カード交換対応版）
    socket.on('startGame', () => {
        if (players.length < 2) return;

        // 1. 場のリセット
        deck = createDeck();
        fieldCards = [];
        discardPile = [];
        passCount = 0;
        isRevolution = false;
        exchangePending = {}; // 交換リストもリセット

        // 2. カードを配る
        players.forEach(p => p.hand = []);
        let pIdx = 0;
        while(deck.length > 0) {
            players[pIdx].hand.push(deck.pop());
            pIdx = (pIdx + 1) % players.length;
        }

        // 手札をソート（これをしておかないと最強カードが見つけにくい）
        players.forEach(p => {
            p.hand.sort((a, b) => getSortValue(a.rank) - getSortValue(b.rank));
        });

        // 3. 階級ごとの処理（2戦目以降）
        let daifugo = players.find(p => p.rank === '大富豪');
        let daibinbo = players.find(p => p.rank === '大貧民');
        let fugo = players.find(p => p.rank === '富豪');
        let binbo = players.find(p => p.rank === '貧民');

        // ★大富豪 vs 大貧民（2枚交換）
        if (daifugo && daibinbo) {
            io.emit('msg', `⚖️ 【カード交換】大貧民(${daibinbo.name})の最強カード2枚を没収します...`);
            
            // 大貧民の最強2枚（配列の最後2枚）を没収
            const c1 = daibinbo.hand.pop();
            const c2 = daibinbo.hand.pop();
            daifugo.hand.push(c1, c2); // 大富豪へ献上
            
            // 大富豪の手札をソートし直す
            daifugo.hand.sort((a, b) => getSortValue(a.rank) - getSortValue(b.rank));

            // 大富豪に「返すカード選んでね」と登録
            exchangePending[daifugo.id] = { targetId: daibinbo.id, count: 2 };
            socket.emit('toSpecificPlayer', daifugo.id, 'chooseGive', daifugo.hand); // ★ここ重要
        }

        // ★富豪 vs 貧民（1枚交換・4人以上の時のみ）
        if (fugo && binbo && players.length >= 4) {
            io.emit('msg', `⚖️ 【カード交換】貧民(${binbo.name})の最強カード1枚を没収します...`);

            // 貧民の最強1枚を没収
            const c1 = binbo.hand.pop();
            fugo.hand.push(c1);
            fugo.hand.sort((a, b) => getSortValue(a.rank) - getSortValue(b.rank));

            // 富豪に「返すカード選んでね」と登録
            exchangePending[fugo.id] = { targetId: binbo.id, count: 1 };
            socket.emit('toSpecificPlayer', fugo.id, 'chooseGive', fugo.hand);
        }

        // 4. スタートプレイヤーを決める
        // 本来は大貧民からスタートですが、簡略化のため「ダイヤの3」を持っている人からにします
        // なければランダム（0番目）
        currentTurnIndex = 0; // 仮
        players.forEach((p, index) => {
            // ダイヤの3を持っている人を探す
            if (p.hand.some(c => c.suit === 'D' && c.rank === 3)) {
                currentTurnIndex = index;
            }
        });
        
        // 5. 順位リセット（交換が終わってから順位を白紙に戻す）
        winOrder = []; 

        io.emit('gameStarted');
        updateGameState();

        // もし交換が発生していたら、対象者に選ばせる
        Object.keys(exchangePending).forEach(playerId => {
            const p = players.find(pl => pl.id === playerId);
            if(p) socket.emit('chooseGive', p.hand); // 該当プレイヤーの画面を「選択モード」にする
        });
    });

    socket.on('playCards', (selectedIndices, optionData) => {
        const player = players.find(p => p.id === socket.id);
        if (!player) return;

        // 自分のターンか確認
        if (players[currentTurnIndex].id !== socket.id) {
            socket.emit('msg', 'まだあなたの番ではありません');
            return;
        }

        // 選択されたカードを取得
        let selectedCards = selectedIndices.map(i => player.hand[i]);

       // ★ここで審判を実行！
        const checkResult = isValidMove(selectedCards, fieldCards);
        if (!checkResult.valid) {
            socket.emit('msg', `❌ ${checkResult.msg}`);
            socket.emit('playSound', 'error'); // ★★★ この1行を追加！ ★★★
            return; 
        }

        // --- 以下、ルールOKの場合の処理 ---

        // 捨て札へ移動
        if (fieldCards.length > 0) discardPile.push(...fieldCards);

        // 場に出す
        fieldCards = selectedCards;
        passCount = 0;
        
        // 手札から削除
        selectedIndices.sort((a, b) => b - a).forEach(idx => {
            player.hand.splice(idx, 1);
        });

        // 効果判定
        let skipTurn = false;
        let eightGiri = false;
        const ranks = selectedCards.map(c => c.rank);
        const isPair = selectedCards.length >= 2;

        if (isPair && ranks.every(r => r === 4)) eightGiri = true;
        if (ranks.includes(5)) skipTurn = true;
        if (isPair && ranks.every(r => r === 6)) eightGiri = true;
        
     // ★★★ 7渡し：選択モードへ ★★★
        // 7が含まれていて、手札がまだ残っている場合
        if (ranks.includes(7) && player.hand.length > 0) {
            // クライアントに「渡すカード選んで」と依頼
            // ※この時点で出したカードは既に手札から消えています
            socket.emit('chooseGive', player.hand);
            
            // 重要：ターンを進めずにここで処理を一旦ストップ！
            updateGameState();
            return; 
        }
        
// ... (7渡しの処理の後) ...

        // ★★★ 12（クイーン）：数字指定捨て（ここに追加！） ★★★
        if (ranks.includes(12)) {
            // クライアントに「数字選んで！」と命令
            socket.emit('chooseTwelveRank');
            
            // ターンを進めずにここで一旦ストップ
            updateGameState();
            return; 
        }
            // ... (8切りの処理へ)

// ... (10捨てなどの処理の後、8切りの前あたり) ...

        // ★★★ 9バック（9拾い）の処理 ★★★
        // 9が含まれていて、かつ捨て札がある場合
        if (ranks.includes(9) && discardPile.length > 0) {
            // ここで一旦ストップ！クライアントに「選んで」と依頼
            socket.emit('chooseDiscard', discardPile);
            
            // 重要：ターンを進めずにここで処理を終える
            updateGameState();
            return; 
        }
        // ★★★ 追加ここまで ★★★

        if (ranks.includes(8)) eightGiri = true;

       // ★★★ 10捨て：選択モードへ ★★★
        // 10が含まれていて、手札がまだ残っている場合
        if (ranks.includes(10) && player.hand.length > 0) {
            // クライアントに「捨てるカード選んで」と依頼
            socket.emit('chooseSelfDiscard', player.hand);
            
            // 重要：ターンを進めずにここで処理を一旦ストップ！
            updateGameState();
            return; 
        }

        // （省略... 10捨てなどの処理の後）

        // ★★★ ここをごっそり書き換え ★★★
        if (ranks.includes(11)) {
            isRevolution = !isRevolution;
            io.emit('msg', isRevolution ? '革命！ (強さが反転)' : '革命返し！ (強さが戻る)');
            io.emit('playSound', 'revolution'); // 革命音！
        } else {
            // 革命じゃない普通の出し方なら、普通のカード音
            io.emit('playSound', 'card'); 
        }
        // ★★★ 書き換えここまで ★★★

        if (ranks.includes(12)) {
            const declaredNum = optionData ? parseInt(optionData) : 3;
            ruleState.twelveBanNum = declaredNum;
            io.emit('msg', `数字「${declaredNum}」縛りが発生！`);
        } else {
            ruleState.twelveBanNum = null;
        }

        // ★★★ 勝敗判定＆順位記録 ★★★
        if (player.hand.length === 0) {
            // まだ上がってないなら、順位リストに追加
            if (!winOrder.includes(player.id)) {
                winOrder.push(player.id);
                io.emit('msg', `🎉 ${player.name} が抜けました！ (${winOrder.length}位)`);
                io.emit('playSound', 'win'); // 勝利音
            }
        }

        // ★★★ ゲーム終了判定（残り1人になったら終わり） ★★★
        if (winOrder.length >= players.length - 1) {
            // 残った1人（ビリ）を特定
            const loser = players.find(p => !winOrder.includes(p.id));
            if (loser) winOrder.push(loser.id);

            // 階級（ランク）を決定する関数を呼ぶ
            assignRanks();

            // ★★★ 修正：結果画面用のデータを送る ★★★
            // winOrder（抜けた順）をもとに、プレイヤー情報を並べ替えて送る
            const sortedResults = winOrder.map(id => players.find(p => p.id === id));
            
            io.emit('showResults', sortedResults); // 新しいイベント発信！
            io.emit('updatePlayers', players); // ロビーのリストも更新
            
            isGameActive = false;
            return;
        }

       // --- 修正箇所ここから ---
        if (eightGiri) {
            // 8切りなら即座に場を流す
            discardPile.push(...fieldCards);
            fieldCards = [];
            
            let msg = '8切り！';

            // ★追加：革命中に8切りで流れたら、革命を終了させる
            if (isRevolution) {
                isRevolution = false;
                msg += '（革命終了！通常に戻ります）';
            }
            
            io.emit('msg', msg);
        } else {
            // 8切りじゃないなら、次の人のターンへ
            let step = 1;
            if (skipTurn) step = 2;
            currentTurnIndex = (currentTurnIndex + step) % players.length;
        }
        // --- 修正箇所ここまで ---

        updateGameState();
    });

    // ★★★ 9バックでカードが選ばれた時の処理 ★★★
    socket.on('nineReturn', (index) => {
        const player = players.find(p => p.id === socket.id);
        if (!player || players[currentTurnIndex].id !== socket.id) return;

        // 捨て札から指定のカードを取得
        if (index >= 0 && index < discardPile.length) {
            const pickedCard = discardPile.splice(index, 1)[0]; // 捨て札から抜く
            player.hand.push(pickedCard); // 手札に入れる
            
            io.emit('msg', `${player.name} が捨て札からカードを拾いました`);
            
            // 効果音（もしあれば）
            io.emit('playSound', 'card'); 
        }

        // ここでようやくターンを進める
        let step = 1;
        // ※もし9の効果でリバース（逆回り）も入れたいならここでstep=-1にするなどの処理が必要
        // 今回はシンプルに「拾うだけ」で次は隣の人へ
        currentTurnIndex = (currentTurnIndex + step) % players.length;

        updateGameState();
    });
    // ★★★ 追加ここまで ★★★

    // ★★★ 7渡しでカードが選ばれた時の処理 ★★★
// ★★★ カード譲渡（7渡し ＆ 開幕の交換） ★★★
    socket.on('giveCard', (index) => {
        const player = players.find(p => p.id === socket.id);
        if (!player) return;

        // --- パターンA：開幕のカード交換中 ---
        if (exchangePending[player.id]) {
            const targetId = exchangePending[player.id].targetId;
            const targetPlayer = players.find(p => p.id === targetId);
            
            if (targetPlayer && index >= 0 && index < player.hand.length) {
                // カードを移動
                const giftCard = player.hand.splice(index, 1)[0];
                targetPlayer.hand.push(giftCard);
                
                // 残り枚数を減らす
                exchangePending[player.id].count--;

                io.emit('msg', `🔄 ${player.name} から ${targetPlayer.name} へカードが渡されました`);
                
                // もう渡さなくていいなら、リストから削除
                if (exchangePending[player.id].count <= 0) {
                    delete exchangePending[player.id];
                    io.emit('updateState', { players, fieldCards, currentTurnIndex, discardPile, isRevolution });
                } else {
                    // まだ渡すなら、もう一回選ばせる（画面更新）
                    socket.emit('chooseGive', player.hand);
                }
            }
            return; // ここで処理終了（ターンは進めない）
        }

        // --- パターンB：通常の7渡し（以前のコード） ---
        if (players[currentTurnIndex].id !== socket.id) return; // 自分の番じゃなければ無視

        const nextPlayerIndex = (currentTurnIndex + 1) % players.length;
        const nextPlayer = players[nextPlayerIndex];

        if (index >= 0 && index < player.hand.length) {
            const giftCard = player.hand.splice(index, 1)[0];
            nextPlayer.hand.push(giftCard);
            
            io.emit('msg', `🎁 ${player.name} から ${nextPlayer.name} へカードが渡されました`);
            io.emit('playSound', 'card');
        }

        currentTurnIndex = (currentTurnIndex + 1) % players.length;
        updateGameState();
    });
    // ★★★ 追加ここまで ★★★

    socket.on('pass', () => {
        if (players[currentTurnIndex].id !== socket.id) return;
        passCount++;
        
        // 全員パスした（場が流れる）ときの処理
        if (passCount >= players.length - 1) {
            if (fieldCards.length > 0) discardPile.push(...fieldCards);
            fieldCards = [];
            passCount = 0;
            io.emit('msg', '場が流れました');

            // ★★★ ここに追加！ ★★★
            // もし革命中なら、ここで終了させる
            if (isRevolution) {
                isRevolution = false;
                io.emit('msg', '場が流れたため、革命終了！(通常に戻ります)');
            }
            // ★★★ 追加ここまで ★★★
        }
        
        currentTurnIndex = (currentTurnIndex + 1) % players.length;
        updateGameState();
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayers', players);
    });

    function updateGameState() {
        io.emit('updateState', {
            players,
            fieldCards,
            discardPile,
            currentTurnIndex,
            isRevolution
        });
    }

    // ★★★ 貼り付け場所はここ！！（部屋の中） ★★★
    
    // ★★★ 10の効果：自分で1枚選んで捨てる ★★★
    socket.on('discardOne', (index) => {
        const player = players.find(p => p.id === socket.id);
        if (!player || players[currentTurnIndex].id !== socket.id) return;

        // 手札から指定のカードを捨てる
        if (index >= 0 && index < player.hand.length) {
            const trashed = player.hand.splice(index, 1)[0];
            discardPile.push(trashed);
            
            io.emit('msg', `🗑️ ${player.name} は手札から1枚捨てました`);
            io.emit('playSound', 'card');
        }

        // ターンを進める
        // (捨てて手札がなくなる可能性もあるのでチェック)
        if (player.hand.length === 0) {
            updateGameState(); // 勝敗判定へ
        } else {
            // 通常通り次へ
            currentTurnIndex = (currentTurnIndex + 1) % players.length;
            updateGameState();
        }
    });

// ★★★ 12の効果：指定された数字を全員（自分含む）捨てさせる ★★★
    socket.on('executeTwelve', (targetRank) => {
        const player = players.find(p => p.id === socket.id);
        if (!player || players[currentTurnIndex].id !== socket.id) return;

        // メッセージ用の数字変換
        let rankName = targetRank;
        if(targetRank === 1) rankName = 'A';
        else if(targetRank === 11) rankName = 'J';
        else if(targetRank === 12) rankName = 'Q';
        else if(targetRank === 13) rankName = 'K';

        io.emit('msg', `👸 ${player.name} の命令！「${rankName}」を持っている人は全員捨てろ！！`);
        io.emit('playSound', 'card'); // 普通の音

        // 全員のハンドをチェックして捨てる
        players.forEach(p => {
            // ★削除しました： if (p.id === socket.id) return; 
            // ↑この行を消したので、自分（player）もチェック対象になります！

            // 指定されたランクのカードを抽出
            const cardsToDiscard = p.hand.filter(c => c.rank === targetRank);
            
            if (cardsToDiscard.length > 0) {
                // 手札から削除
                p.hand = p.hand.filter(c => c.rank !== targetRank);
                
                // 捨て札に追加
                discardPile.push(...cardsToDiscard);

                io.emit('msg', `💨 ${p.name} は ${cardsToDiscard.length}枚の [${rankName}] を捨てさせられた...`);
            }
        });

        // ターンを進める
        // (命令によって自分の手札がなくなって上がる可能性もあるのでチェック)
        if (player.hand.length === 0) {
            updateGameState(); // 勝敗判定へ（updateGameState内でwinOrder処理が走る）
        } else {
            // まだ手札があるなら次の人へ
            currentTurnIndex = (currentTurnIndex + 1) % players.length;
            updateGameState();
        }
    });

});    

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ★★★ 階級割り当て関数 ★★★
function assignRanks() {
    const count = players.length;
    winOrder.forEach((id, index) => {
        const player = players.find(p => p.id === id);
        if (!player) return;
        
        let rank = '';
        if (index === 0) rank = '大富豪';
        else if (index === count - 1) rank = '大貧民';
        else {
            if (count === 4) rank = (index === 1) ? '富豪' : '貧民';
            else rank = '平民';
        }
        player.rank = rank;
    });
}

// ★★★ サーバー用：カードの強さ数値 ★★★
function getSortValue(rank) {
    if (rank === 14 || rank === 15) return 20; 
    if (rank === 1) return 14; 
    if (rank === 2) return 15; 
    return rank; 
}