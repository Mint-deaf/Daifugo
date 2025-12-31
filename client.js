const socket = io();

// 音ファイルの読み込み
const sounds = {
    card: new Audio('card.mp3'),
    error: new Audio('error.mp3'),
    revolution: new Audio('revolution.mp3'),
    win: new Audio('win.mp3')
};

// ★変数宣言（1回だけ！）
let selectedIndices = [];
let isPickingMode = false; 

// カードのマーク変換
function getSuitSymbol(suit) {
    if (suit === 'S') return '♠';
    if (suit === 'H') return '♥';
    if (suit === 'D') return '♦';
    if (suit === 'C') return '♣';
    return suit;
}

// カードの数字変換
function getRankSymbol(rank) {
    if (rank === 1) return 'A';
    if (rank === 11) return 'J';
    if (rank === 12) return 'Q';
    if (rank === 13) return 'K';
    if (rank === 14 || rank === 15) return 'JOKER';
    return rank;
}

// ソート用の強さ数値
function getSortValue(rank) {
    if (rank === 14 || rank === 15) return 20; // Joker
    if (rank === 1) return 14; // A
    if (rank === 2) return 15; // 2
    return rank; // 3~13
}

// --- イベントリスナー設定 ---

// 参加ボタン
document.getElementById('join-btn').addEventListener('click', () => {
    const name = document.getElementById('username').value;
    if(name) {
        socket.emit('joinGame', name);
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'block'; 
    }
});

// 開始ボタン
document.getElementById('start-btn').addEventListener('click', () => {
    socket.emit('startGame');
});

// パスボタン
document.getElementById('pass-btn').addEventListener('click', () => {
    socket.emit('pass');
    selectedIndices = [];
});

// 出すボタン
document.getElementById('play-btn').addEventListener('click', () => {
    const declareVal = document.getElementById('declare-num').value;
    socket.emit('playCards', selectedIndices, declareVal);
    selectedIndices = [];
});

// 履歴ボタン
const modal = document.getElementById('history-modal');
document.getElementById('history-btn').addEventListener('click', () => {
    modal.style.display = 'block';
});
document.getElementById('close-history').addEventListener('click', () => {
    modal.style.display = 'none';
});
window.onclick = (event) => {
    if (event.target == modal) {
        modal.style.display = 'none';
    }
};

// --- Socket受信設定 ---

socket.on('updateState', (state) => {
    renderGame(state);
});

socket.on('msg', (msg) => {
    console.log(msg);
});

socket.on('gameStarted', () => {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
});

socket.on('gameOver', (msg) => {
    alert(msg);
    location.reload();
});

// 音と演出
socket.on('playSound', (type) => {
    if (sounds[type]) {
        sounds[type].currentTime = 0;
        sounds[type].play().catch(e => console.log('音の再生に失敗:', e));
    }
    // 革命演出
    if (type === 'revolution') {
        const overlay = document.getElementById('revolution-overlay');
        overlay.classList.add('active');
        setTimeout(() => {
            overlay.classList.remove('active');
        }, 3000);
    }
});

// メンバーリスト更新（階級表示対応版）
socket.on('updatePlayers', (players) => {
    const list = document.getElementById('member-list');
    list.innerHTML = ''; 

    players.forEach(p => {
        const li = document.createElement('li');

        // ★★★ ランクに応じたアイコンを決める ★★★
        let icon = '👤'; // デフォルト
        if (p.rank === '大富豪') icon = '👑';
        if (p.rank === '富豪') icon = '💰';
        if (p.rank === '平民') icon = '🙂';
        if (p.rank === '貧民') icon = '💸';
        if (p.rank === '大貧民') icon = '💩';

        // ランクがある時だけ「[大富豪]」みたいな文字を作る
        const rankText = p.rank ? ` [${p.rank}]` : '';

        // 自分には「(あなた)」をつける
        if (p.id === socket.id) {
            li.textContent = `${icon} ${p.name}${rankText} (あなた)`;
            li.style.fontWeight = 'bold';
            // 大富豪なら金文字、それ以外は白（自分用）
            li.style.color = p.rank === '大富豪' ? '#ffd700' : '#ffffff'; 
        } else {
            // 他の人
            li.textContent = `${icon} ${p.name}${rankText}`;
            li.style.color = '#ffffff';
        }
        
        li.style.margin = "5px 0";
        li.style.borderBottom = "1px solid rgba(255,255,255,0.2)";
        
        list.appendChild(li);
    });
});

// 9バック（拾う）処理
socket.on('chooseDiscard', (serverDiscardPile) => {
    isPickingMode = true; 

    const modal = document.getElementById('history-modal');
    const discardDiv = document.getElementById('discard-list');
    const title = modal.querySelector('h2');

    modal.style.display = 'block';
    title.textContent = "🖐️ 拾うカードを選んでください！";
    title.style.color = "#e67e22";

    discardDiv.innerHTML = '';

    serverDiscardPile.forEach((card, originalIndex) => {
        const cEl = createCardElement(card);
        cEl.style.transform = "scale(0.9)";
        cEl.style.margin = "5px";
        cEl.style.cursor = "pointer";
        
        cEl.onmouseover = () => { cEl.style.border = "3px solid #e67e22"; };
        cEl.onmouseout = () => { cEl.style.border = "none"; };

        cEl.onclick = () => {
            const confirmModal = document.getElementById('confirm-modal');
            const previewDiv = document.getElementById('confirm-card-preview');
            const yesBtn = document.getElementById('confirm-yes-btn');
            const noBtn = document.getElementById('confirm-no-btn');
            
            // 文言セット
            const confirmTitle = confirmModal.querySelector('h2');
            confirmTitle.textContent = "このカードを拾いますか？";
            confirmTitle.style.color = "#ffd700";
            yesBtn.textContent = "はい、拾います";

            previewDiv.innerHTML = '';
            const previewCard = createCardElement(card);
            previewCard.style.cursor = 'default'; 
            previewDiv.appendChild(previewCard);

            confirmModal.style.display = 'block';

            yesBtn.onclick = () => {
                confirmModal.style.display = 'none';
                socket.emit('nineReturn', originalIndex);
                modal.style.display = 'none';
                title.textContent = "捨てられたカード一覧";
                title.style.color = "white";
                isPickingMode = false;
            };

            noBtn.onclick = () => {
                confirmModal.style.display = 'none'; 
            };
        };
        discardDiv.appendChild(cEl);
    });
});

// 7渡し（あげる）処理
socket.on('chooseGive', (currentHand) => {
    isPickingMode = true; 

    const modal = document.getElementById('history-modal'); 
    const listDiv = document.getElementById('discard-list'); 
    const title = modal.querySelector('h2');

    modal.style.display = 'block';
    title.textContent = "😈 相手に押し付けるカードを選んでください";
    title.style.color = "#e74c3c"; 

    listDiv.innerHTML = '';

    currentHand.forEach((card, originalIndex) => {
        const cEl = createCardElement(card);
        cEl.style.transform = "scale(0.9)";
        cEl.style.margin = "5px";
        cEl.style.cursor = "pointer";
        
        cEl.onmouseover = () => { cEl.style.border = "3px solid #e74c3c"; };
        cEl.onmouseout = () => { cEl.style.border = "none"; };

        cEl.onclick = () => {
            const confirmModal = document.getElementById('confirm-modal');
            const previewDiv = document.getElementById('confirm-card-preview');
            const yesBtn = document.getElementById('confirm-yes-btn');
            const noBtn = document.getElementById('confirm-no-btn');
            const confirmTitle = confirmModal.querySelector('h2');

            // 文言変更
            confirmTitle.textContent = "このカードを渡しますか？";
            confirmTitle.style.color = "#e74c3c";
            yesBtn.textContent = "はい、渡します";

            previewDiv.innerHTML = '';
            const previewCard = createCardElement(card);
            previewDiv.appendChild(previewCard);

            confirmModal.style.display = 'block';

            yesBtn.onclick = () => {
                confirmModal.style.display = 'none';
                socket.emit('giveCard', originalIndex); 
                modal.style.display = 'none';
                title.textContent = "捨てられたカード一覧"; 
                title.style.color = "white";
                isPickingMode = false;
            };

            noBtn.onclick = () => {
                confirmModal.style.display = 'none';
            };
        };
        listDiv.appendChild(cEl);
    });
});

// --- 関数定義 ---

function createCardElement(card, index = null, isSelected = false) {
    const div = document.createElement('div');
    div.className = 'card';
    
    if (card.suit === 'H' || card.suit === 'D') div.classList.add('red');
    else if (card.suit === 'Joker') div.classList.add('joker');
    else div.classList.add('black');

    if (isSelected) div.classList.add('selected');

    const suitSym = getSuitSymbol(card.suit);
    const rankSym = getRankSymbol(card.rank);

  if (card.suit === 'Joker') {
        div.innerHTML = `<div class="card-center" style="font-size:20px; line-height: 1.2;">JO<br>KER</div>`;
    } else {
        div.innerHTML = `
            <div class="card-top">${rankSym}<br>${suitSym}</div>
            <div class="card-center">${suitSym}</div>
            <div class="card-bottom">${rankSym}<br>${suitSym}</div>
        `;
    }

    if (index !== null) {
        div.onclick = () => {
            if (selectedIndices.includes(index)) {
                selectedIndices = selectedIndices.filter(i => i !== index);
            } else {
                selectedIndices.push(index);
            }
            div.classList.toggle('selected');
        };
    }
    return div;
}

function renderGame(state) {
    const myData = state.players.find(p => p.id === socket.id);
    if (!myData) return;

    const turnPlayer = state.players[state.currentTurnIndex];
    document.getElementById('turn-indicator').textContent = 
        turnPlayer.id === socket.id ? "あなたの番です！" : `${turnPlayer.name} の思考中...`;
    document.getElementById('rev-indicator').textContent = state.isRevolution ? "⚠ 革命中 ⚠" : "";

    // 場のカード
    const fieldDiv = document.getElementById('field-cards');
    fieldDiv.innerHTML = '';
    state.fieldCards.forEach(card => {
        fieldDiv.appendChild(createCardElement(card));
    });

    // 自分の手札
    const handDiv = document.getElementById('my-hand');
    handDiv.innerHTML = '';
    myData.hand.forEach((card, index) => {
        const isSel = selectedIndices.includes(index);
        const cardEl = createCardElement(card, index, isSel);
        // ここでのonclickはcreateCardElement内で設定しているので不要
        handDiv.appendChild(cardEl);
    });

    // 相手情報（自分以外）
    const opponentsDiv = document.getElementById('opponents');
    opponentsDiv.innerHTML = '';
    state.players.forEach(p => {
        if (p.id !== socket.id) {
            const pDiv = document.createElement('div');
            pDiv.style.margin = "5px";
            pDiv.style.display = "inline-block";
            pDiv.style.background = "rgba(0,0,0,0.5)";
            pDiv.style.padding = "5px 15px";
            pDiv.style.borderRadius = "15px";
            pDiv.style.color = "white";
            pDiv.style.fontSize = "16px";
            
            pDiv.textContent = `${p.name}: 残り ${p.hand.length} 枚`;

            if (state.players[state.currentTurnIndex].id === p.id) {
                pDiv.style.border = "3px solid #e67e22";
                pDiv.style.background = "rgba(230, 126, 34, 0.5)";
                pDiv.style.fontWeight = "bold";
                pDiv.textContent += " (思考中...)";
            }
            opponentsDiv.appendChild(pDiv);
        }
    });

    // 捨て札リスト（選択モード中は更新しない）
    if (!isPickingMode) {
        const discardDiv = document.getElementById('discard-list');
        discardDiv.innerHTML = '';
        
        const sortedDiscard = [...state.discardPile].sort((a, b) => getSortValue(a.rank) - getSortValue(b.rank));
        
        sortedDiscard.forEach(card => {
            const cEl = createCardElement(card);
            cEl.style.transform = "scale(0.8)";
            cEl.style.margin = "2px";
            cEl.style.cursor = "default";
            discardDiv.appendChild(cEl);
        });
    }
}

// ★★★ リザルト画面の表示 ★★★
socket.on('showResults', (sortedResults) => {
    const modal = document.getElementById('result-modal');
    const listDiv = document.getElementById('result-list');
    const backBtn = document.getElementById('back-to-lobby-btn');
    
    // 勝利音を鳴らす
    if(sounds.win) sounds.win.play().catch(()=>{});

    listDiv.innerHTML = '';
    
    // 順位リストを作成
    sortedResults.forEach((p, index) => {
        const row = document.createElement('div');
        row.className = 'result-row';
        
        // 1位とビリに特別なクラスをつける
        if (index === 0) row.classList.add('rank-1');
        if (index === sortedResults.length - 1) row.classList.add('rank-last');
        
        // アニメーションをずらす（1位が最初に出るか、最後に出るかはお好みで。ここは順に出します）
        row.style.animationDelay = `${index * 0.2}s`; 

        const rankNum = index + 1;
        let icon = '';
        if (p.rank === '大富豪') icon = '👑';
        else if (p.rank === '大貧民') icon = '💩';
        else icon = '👤';

        // 表示内容
        row.innerHTML = `
            <span style="font-size: 24px; width: 40px;">${rankNum}位</span>
            <div style="flex-grow: 1; text-align: left; margin-left: 20px;">
                <span style="font-size: 1.2em;">${p.name}</span>
                <br>
                <span style="font-size: 0.8em; opacity: 0.8;">${p.rank || ''}</span>
            </div>
            <div style="font-size: 30px;">${icon}</div>
        `;

        listDiv.appendChild(row);
    });

    // 画面を表示
    modal.style.display = 'flex'; // flexにして中央寄せ
    modal.style.flexDirection = 'column';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';

    // 「ロビーに戻る」ボタン
    backBtn.onclick = () => {
        modal.style.display = 'none';
        // ロビー画面に戻す（ゲーム画面を隠す）
        document.getElementById('game-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'block';
        document.getElementById('start-btn').style.display = 'block'; // スタートボタン復活
    };
});

// ... (既存コードの一番下に追加) ...

// ★★★ 12の効果：数字選択モード ★★★
socket.on('chooseTwelveRank', () => {
    isPickingMode = true; // 操作ブロック

    const modal = document.getElementById('number-select-modal');
    const btnContainer = document.getElementById('number-buttons');
    
    // ボタンの中身を作る
    btnContainer.innerHTML = '';
    
    // 3,4,5...13,1,2 の順に並べる
    const order = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 2];
    
    order.forEach(rank => {
        const btn = document.createElement('button');
        
        // 表示文字（1→A, 13→Kなど）
        let text = rank;
        if(rank === 1) text = 'A';
        if(rank === 11) text = 'J';
        if(rank === 12) text = 'Q';
        if(rank === 13) text = 'K';
        
        btn.textContent = text;
        
        // スタイル（CSSでやってもいいですが、ここで直接指定）
        btn.style.width = '50px';
        btn.style.height = '50px';
        btn.style.fontSize = '20px';
        btn.style.borderRadius = '10px';
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.style.background = '#fff';
        btn.style.fontWeight = 'bold';
        btn.style.boxShadow = '0 4px 0 #ccc';
        
        // クリックした時の動作
        btn.onclick = () => {
            modal.style.display = 'none';
            isPickingMode = false;
            
            // サーバーに「この数字を消せ！」と命令
            socket.emit('executeTwelve', rank);
        };
        
        btnContainer.appendChild(btn);
    });
    
    // モーダル表示
    modal.style.display = 'block';
});

// ★★★ 10捨て：自分のカードを捨てるモード ★★★
socket.on('chooseSelfDiscard', (currentHand) => {
    isPickingMode = true;

    const modal = document.getElementById('history-modal'); 
    const listDiv = document.getElementById('discard-list'); 
    const title = modal.querySelector('h2');

    modal.style.display = 'block';
    title.textContent = "🗑️ 捨てるカードを1枚選んでください";
    title.style.color = "#a5b1c2"; // 灰色っぽい色

    listDiv.innerHTML = '';

    currentHand.forEach((card, originalIndex) => {
        const cEl = createCardElement(card);
        cEl.style.transform = "scale(0.9)";
        cEl.style.margin = "5px";
        cEl.style.cursor = "pointer";
        
        cEl.onmouseover = () => { cEl.style.border = "3px solid #a5b1c2"; };
        cEl.onmouseout = () => { cEl.style.border = "none"; };

        cEl.onclick = () => {
            const confirmModal = document.getElementById('confirm-modal');
            const previewDiv = document.getElementById('confirm-card-preview');
            const yesBtn = document.getElementById('confirm-yes-btn');
            const noBtn = document.getElementById('confirm-no-btn');
            const confirmTitle = confirmModal.querySelector('h2');

            // 文言変更
            confirmTitle.textContent = "このカードを捨てますか？";
            confirmTitle.style.color = "#a5b1c2";
            yesBtn.textContent = "はい、捨てます";

            previewDiv.innerHTML = '';
            const previewCard = createCardElement(card);
            previewDiv.appendChild(previewCard);

            confirmModal.style.display = 'block';

            yesBtn.onclick = () => {
                confirmModal.style.display = 'none';
                socket.emit('discardOne', originalIndex); // サーバーに報告
                
                modal.style.display = 'none';
                title.textContent = "捨てられたカード一覧"; 
                title.style.color = "white";
                isPickingMode = false;
            };

            noBtn.onclick = () => {
                confirmModal.style.display = 'none';
            };
        };
        listDiv.appendChild(cEl);
    });
});