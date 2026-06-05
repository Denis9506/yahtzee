const dices = document.querySelectorAll('.dice');
const diceWrappers = document.querySelectorAll('.dice-wrapper');
const rollBtn = document.getElementById('roll-btn');
const rollsLeftSpan = document.getElementById('rolls-left');
const currentPlayerNameSpan = document.getElementById('current-player-name');
const p1Header = document.querySelector('.p1-header');
const p2Header = document.querySelector('.p2-header');

let currentX = [0, 0, 0, 0, 0];
let currentY = [0, 0, 0, 0, 0];
let diceValues = [1, 1, 1, 1, 1];
let heldDice = [false, false, false, false, false];

let rollsLeft = 3;
let currentPlayer = 1;
let hasRolled = false;

let p1Name = "Player 1";
let p2Name = "Player 2";

const scores = { 1: {}, 2: {} };

let turnTimerInterval = null;
let turnTimeLeft = 120; // 2 minutes

const categories = [
    'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
    'threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'chance', 'yahtzee'
];

// --- NETWORK STATE ---
let peer = null;
let conn = null;
let isHost = false;
let myPlayerId = 0;
let p1Ready = false;
let p2Ready = false;
let p1NameReady = false;
let p2NameReady = false;
let gameStarted = false;

function initNetwork() {
    const urlParams = new URLSearchParams(window.location.search);
    const hostId = urlParams.get('host');

    peer = new Peer();

    if (!hostId) {
        // I AM HOST (Player 1)
        isHost = true;
        myPlayerId = 1;

        peer.on('open', (id) => {
            document.getElementById('connection-title').textContent = "Game Created!";
            const joinUrl = window.location.href.split('?')[0] + '?host=' + id;
            document.getElementById('share-link').value = joinUrl;
            document.getElementById('connection-link-container').classList.remove('hidden');
        });

        document.getElementById('copy-link-btn').addEventListener('click', () => {
            document.getElementById('share-link').select();
            document.execCommand('copy');
            document.getElementById('copy-link-btn').textContent = "Copied!";
        });

        peer.on('connection', (connection) => {
            if (conn) return;
            conn = connection;
            setupConnection();
        });

    } else {
        // I AM CLIENT (Player 2)
        isHost = false;
        myPlayerId = 2;
        document.getElementById('connection-title').textContent = "Joining Game...";
        document.getElementById('joining-container').classList.remove('hidden');

        peer.on('open', (id) => {
            conn = peer.connect(hostId);
            conn.on('open', () => {
                setupConnection();
            });
            conn.on('error', (err) => {
                alert("Failed to connect: " + err);
            });
        });
    }
}

function setupConnection() {
    document.getElementById('connection-overlay').classList.add('hidden');

    conn.on('data', handleNetworkData);
    conn.on('close', handleDisconnect);
    conn.on('error', handleDisconnect);

    if (peer) {
        peer.on('error', handleDisconnect);
    }

    const nameModal = document.getElementById('name-modal');
    nameModal.classList.remove('hidden');

    if (myPlayerId === 1) {
        document.getElementById('name-modal-title').textContent = "You are Player 1";
        document.getElementById('p2-name-input').disabled = true;
        document.getElementById('p2-name-input').value = "Waiting...";
    } else {
        document.getElementById('name-modal-title').textContent = "You are Player 2";
        document.getElementById('p1-name-input').disabled = true;
        document.getElementById('p1-name-input').value = "Waiting...";
    }

    setupGameListeners();
    updatePlayerUI();
}

function handleDisconnect() {
    showGameOverModal(true);
}

function sendData(type, payload) {
    if (conn && conn.open) {
        conn.send({ type, payload });
    }
}

function handleNetworkData(data) {
    const { type, payload } = data;
    switch (type) {
        case 'NAME_UPDATE':
            if (payload.player === 1) {
                p1Name = payload.name;
                document.getElementById('p1-name-input').value = p1Name;
            } else {
                p2Name = payload.name;
                document.getElementById('p2-name-input').value = p2Name;
            }
            updatePlayerUI();
            break;
        case 'NAME_READY':
            if (payload.player === 1) p1NameReady = true;
            else p2NameReady = true;
            checkStartGame();
            break;
        case 'ROLL_DICE':
            rollBtn.disabled = true;
            hasRolled = true;
            rollsLeft--;
            rollsLeftSpan.textContent = rollsLeft;
            diceValues = payload.randoms;
            dices.forEach((dice, i) => {
                if (!heldDice[i]) rollDie(dice, i, diceValues[i]);
            });
            setTimeout(() => {
                if (rollsLeft > 0 && currentPlayer === myPlayerId) {
                    rollBtn.disabled = false;
                }
            }, 1200);
            break;
        case 'TOGGLE_HOLD':
            heldDice[payload.index] = payload.state;
            diceWrappers[payload.index].classList.toggle('held', payload.state);
            break;
        case 'SCORE_CATEGORY':
            scores[currentPlayer][payload.category] = payload.score;
            const cell = document.querySelector(`tr[data-category="${payload.category}"] .p${currentPlayer}-cell`);
            cell.textContent = payload.score;
            cell.classList.remove('potential');
            updateTotals(currentPlayer);
            checkGameOver();
            break;
        case 'PLAYER_READY':
            if (payload.player === 1) p1Ready = true;
            else p2Ready = true;
            checkRestart();
            break;
        case 'RESTART_GAME':
            resetGameInternal(payload.startPlayer);
            break;
        case 'START_PLAYER':
            currentPlayer = payload.startPlayer;
            if (!gameStarted) {
                gameStarted = true;
                document.getElementById('name-modal').classList.add('hidden');
                const btn = document.getElementById('start-game-btn');
                btn.textContent = "Save Name";
                btn.disabled = false;
            }
            updatePlayerUI();
            if (!turnTimerInterval) {
                startTurnTimer();
            }
            break;
        case 'TIME_UP':
            triggerTimeUpEnd();
            break;
        case 'ADD_TIME':
            turnTimeLeft += payload.amount || 60;
            updateTimerUI();
            break;
        case 'DISCONNECT':
            handleDisconnect();
            break;
    }
}

document.getElementById('start-game-btn').addEventListener('click', () => {
    const myName = myPlayerId === 1 ? document.getElementById('p1-name-input').value.trim() : document.getElementById('p2-name-input').value.trim();
    if (myPlayerId === 1) p1Name = myName || "Player 1";
    if (myPlayerId === 2) p2Name = myName || "Player 2";

    sendData('NAME_UPDATE', { player: myPlayerId, name: myPlayerId === 1 ? p1Name : p2Name });

    if (!gameStarted) {
        const btn = document.getElementById('start-game-btn');
        btn.textContent = "Waiting for other player...";
        btn.disabled = true;

        if (myPlayerId === 1) p1NameReady = true;
        else p2NameReady = true;

        sendData('NAME_READY', { player: myPlayerId });
        checkStartGame();
    } else {
        document.getElementById('name-modal').classList.add('hidden');
        updatePlayerUI();
    }
});

function checkStartGame() {
    if (p1NameReady && p2NameReady && !gameStarted) {
        gameStarted = true;
        document.getElementById('name-modal').classList.add('hidden');

        const btn = document.getElementById('start-game-btn');
        btn.textContent = "Save Name";
        btn.disabled = false;

        if (isHost) {
            const startPlayer = Math.random() < 0.5 ? 1 : 2;
            currentPlayer = startPlayer;
            sendData('START_PLAYER', { startPlayer });
            updatePlayerUI();
            if (!turnTimerInterval) {
                startTurnTimer();
            }
        }
    }
}

document.getElementById('edit-names-btn').addEventListener('click', () => {
    document.getElementById('name-modal').classList.remove('hidden');
});

function setupGameListeners() {
    diceWrappers.forEach((wrapper, index) => {
        wrapper.addEventListener('click', () => {
            if (currentPlayer !== myPlayerId || !hasRolled) return;
            heldDice[index] = !heldDice[index];
            wrapper.classList.toggle('held', heldDice[index]);
            sendData('TOGGLE_HOLD', { index, state: heldDice[index] });
        });
    });

    document.querySelectorAll('.score-cell').forEach(cell => {
        cell.addEventListener('click', function () {
            if (currentPlayer !== myPlayerId || !hasRolled) return;
            const player = parseInt(this.getAttribute('data-player'));
            if (player !== currentPlayer) return;

            const tr = this.closest('tr');
            const cat = tr.getAttribute('data-category');

            let score;
            if (scores[currentPlayer][cat] !== undefined) {
                if (cat === 'yahtzee' && scores[currentPlayer][cat] > 0 && calcScore('yahtzee', diceValues) === 50) {
                    score = scores[currentPlayer][cat] + 100;
                } else {
                    return;
                }
            } else {
                score = calcScore(cat, diceValues);
            }

            scores[currentPlayer][cat] = score;

            this.textContent = score;
            this.classList.remove('potential');

            sendData('SCORE_CATEGORY', { category: cat, score });

            updateTotals(currentPlayer);
            checkGameOver();
        });
    });

    const timerDisplay = document.getElementById('turn-timer');
    if (timerDisplay) {
        timerDisplay.addEventListener('click', () => {
            if (!gameStarted || turnTimeLeft <= 0) return;
            turnTimeLeft += 60;
            updateTimerUI();
            sendData('ADD_TIME', { amount: 60 });
        });
    }
}

function startTurnTimer() {
    clearInterval(turnTimerInterval);
    turnTimeLeft = 120;
    updateTimerUI();

    turnTimerInterval = setInterval(() => {
        turnTimeLeft--;
        updateTimerUI();

        if (turnTimeLeft <= 0) {
            clearInterval(turnTimerInterval);
            handleTimeUp();
        }
    }, 1000);
}

function updateTimerUI() {
    const timerDisplay = document.getElementById('turn-timer');
    if (!timerDisplay) return;

    const m = Math.floor(turnTimeLeft / 60).toString().padStart(2, '0');
    const s = (turnTimeLeft % 60).toString().padStart(2, '0');
    timerDisplay.textContent = `${m}:${s}`;

    if (turnTimeLeft <= 10) {
        timerDisplay.classList.add('warning');
    } else {
        timerDisplay.classList.remove('warning');
    }
}

function handleTimeUp() {
    if (currentPlayer === myPlayerId) {
        sendData('TIME_UP', {});
        triggerTimeUpEnd();
    }
}

function triggerTimeUpEnd() {
    clearInterval(turnTimerInterval);
    showGameOverModal(false, true);
}

function updatePlayerUI() {
    currentPlayerNameSpan.textContent = currentPlayer === 1 ? p1Name : p2Name;
    if (currentPlayer === 1) {
        p1Header.classList.add('active-player');
        p2Header.classList.remove('active-player');
    } else {
        p2Header.classList.add('active-player');
        p1Header.classList.remove('active-player');
    }
    p1Header.textContent = p1Name;
    p2Header.textContent = p2Name;

    if (gameStarted && currentPlayer === myPlayerId && rollsLeft > 0) {
        rollBtn.disabled = false;
    } else {
        rollBtn.disabled = true;
    }

    clearPotentials();
    if (gameStarted && currentPlayer === myPlayerId) {
        showPotentials();
    }
}

rollBtn.addEventListener('click', () => {
    if (currentPlayer !== myPlayerId || rollsLeft <= 0 || rollBtn.disabled) return;

    rollBtn.disabled = true;
    hasRolled = true;
    rollsLeft--;
    rollsLeftSpan.textContent = rollsLeft;

    const randoms = [];
    dices.forEach((dice, i) => {
        if (!heldDice[i]) {
            const r = Math.floor(Math.random() * 6) + 1;
            randoms[i] = r;
            diceValues[i] = r;
            rollDie(dice, i, r);
        } else {
            randoms[i] = diceValues[i];
        }
    });

    sendData('ROLL_DICE', { randoms });

    setTimeout(() => {
        showPotentials();
        if (rollsLeft > 0 && currentPlayer === myPlayerId) {
            rollBtn.disabled = false;
        }
    }, 1200);
});

function rollDie(dice, index, random) {
    let targetX = 0, targetY = 0;
    switch (random) {
        case 1: targetX = 0; targetY = 0; break;
        case 6: targetX = 180; targetY = 0; break;
        case 2: targetX = -90; targetY = 0; break;
        case 5: targetX = 90; targetY = 0; break;
        case 3: targetX = 0; targetY = 90; break;
        case 4: targetX = 0; targetY = -90; break;
    }

    currentX[index] = currentX[index] + 720 + (targetX - (currentX[index] % 360));
    currentY[index] = currentY[index] + 720 + (targetY - (currentY[index] % 360));

    dice.style.transform = `rotateX(${currentX[index]}deg) rotateY(${currentY[index]}deg)`;
}

function calcScore(category, values) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    let sum = 0;
    values.forEach(v => { counts[v]++; sum += v; });

    const hasN = n => counts.some(c => c >= n);

    switch (category) {
        case 'ones': return counts[1] * 1;
        case 'twos': return counts[2] * 2;
        case 'threes': return counts[3] * 3;
        case 'fours': return counts[4] * 4;
        case 'fives': return counts[5] * 5;
        case 'sixes': return counts[6] * 6;
        case 'threeOfAKind': return hasN(3) ? sum : 0;
        case 'fourOfAKind': return hasN(4) ? sum : 0;
        case 'fullHouse': return (counts.includes(3) && counts.includes(2)) ? 25 : 0;
        case 'smallStraight':
            const uStr = [...new Set(values)].sort().join('');
            return (uStr.includes('1234') || uStr.includes('2345') || uStr.includes('3456')) ? 30 : 0;
        case 'largeStraight':
            const uStr2 = [...new Set(values)].sort().join('');
            return (uStr2 === '12345' || uStr2 === '23456') ? 40 : 0;
        case 'chance': return sum;
        case 'yahtzee': return hasN(5) ? 50 : 0;
    }
    return 0;
}

function showPotentials() {
    clearPotentials();
    if (!hasRolled || currentPlayer !== myPlayerId) return;

    categories.forEach(cat => {
        const cell = document.querySelector(`tr[data-category="${cat}"] .p${currentPlayer}-cell`);
        if (!cell) return;

        if (scores[currentPlayer][cat] === undefined) {
            cell.textContent = calcScore(cat, diceValues);
            cell.classList.add('potential');
        } else if (cat === 'yahtzee' && scores[currentPlayer][cat] > 0 && calcScore('yahtzee', diceValues) === 50) {
            cell.textContent = scores[currentPlayer][cat] + 100;
            cell.classList.add('potential');
        }
    });
}

function clearPotentials() {
    document.querySelectorAll('.score-cell.potential').forEach(cell => {
        const player = parseInt(cell.getAttribute('data-player'));
        const cat = cell.closest('tr').getAttribute('data-category');
        if (scores[player][cat] !== undefined) {
            cell.textContent = scores[player][cat];
        } else {
            cell.textContent = '';
        }
        cell.classList.remove('potential');
    });
}

function updateTotals(player) {
    let upperSum = 0;
    ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].forEach(cat => {
        if (scores[player][cat] !== undefined) upperSum += scores[player][cat];
    });

    const sumCell = document.querySelector(`.p${player}-sum`);
    sumCell.textContent = `${upperSum} / 63`;

    let bonus = upperSum >= 63 ? 35 : 0;
    const bonusCell = document.querySelector(`.p${player}-bonus`);
    bonusCell.textContent = `+ ${bonus}`;

    let total = upperSum + bonus;
    ['threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'chance', 'yahtzee'].forEach(cat => {
        if (scores[player][cat] !== undefined) total += scores[player][cat];
    });

    const totalCell = document.querySelector(`.p${player}-total`);
    totalCell.textContent = total;
}

function checkGameOver() {
    const p1Done = Object.keys(scores[1]).length === 13;
    const p2Done = Object.keys(scores[2]).length === 13;

    if (p1Done && p2Done) {
        showGameOverModal(false);
    } else {
        switchPlayer();
    }
}

function showGameOverModal(isEarlyDisconnect, isTimeUp = false) {
    clearInterval(turnTimerInterval);
    setTimeout(() => {
        const p1Total = parseInt(document.querySelector('.p1-total').textContent) || 0;
        const p2Total = parseInt(document.querySelector('.p2-total').textContent) || 0;

        const modal = document.getElementById('game-over-modal');
        const title = document.getElementById('modal-title');

        document.getElementById('modal-p1-name').textContent = p1Name;
        document.getElementById('modal-p2-name').textContent = p2Name;
        document.getElementById('modal-p1-score').textContent = p1Total;
        document.getElementById('modal-p2-score').textContent = p2Total;

        p1Ready = false;
        p2Ready = false;
        const playAgainBtn = document.getElementById('play-again-btn');
        playAgainBtn.textContent = "Play Again";
        playAgainBtn.disabled = false;

        if (isEarlyDisconnect) {
            title.textContent = "Player Disconnected 🛑";
            playAgainBtn.textContent = "Exit Game";
        } else if (isTimeUp) {
            title.textContent = "Time's Up! ⏰";
        } else {
            if (p1Total > p2Total) title.textContent = `${p1Name} Wins! 🎉`;
            else if (p2Total > p1Total) title.textContent = `${p2Name} Wins! 🎉`;
            else title.textContent = "It's a Tie! 🤝";
        }

        modal.classList.remove('hidden');
    }, 300);
}

document.getElementById('play-again-btn').addEventListener('click', () => {
    const btn = document.getElementById('play-again-btn');
    if (btn.textContent === "Exit Game") {
        window.location.href = window.location.pathname;
        return;
    }

    btn.textContent = "Waiting for other player...";
    btn.disabled = true;

    if (myPlayerId === 1) p1Ready = true;
    else p2Ready = true;

    sendData('PLAYER_READY', { player: myPlayerId });
    checkRestart();
});

function checkRestart() {
    if (p1Ready && p2Ready) {
        if (isHost) {
            const startPlayer = Math.random() < 0.5 ? 1 : 2;
            sendData('RESTART_GAME', { startPlayer });
            resetGameInternal(startPlayer);
        }
    }
}

function resetGameInternal(startPlayer) {
    scores[1] = {};
    scores[2] = {};
    currentPlayer = startPlayer;
    rollsLeft = 3;
    hasRolled = false;
    diceValues = [1, 1, 1, 1, 1];
    heldDice = [false, false, false, false, false];
    currentX = [0, 0, 0, 0, 0];
    currentY = [0, 0, 0, 0, 0];

    rollsLeftSpan.textContent = rollsLeft;
    diceWrappers.forEach(w => w.classList.remove('held'));
    dices.forEach(d => d.style.transform = `rotateX(0deg) rotateY(0deg)`);

    document.querySelectorAll('.score-cell').forEach(cell => {
        cell.textContent = '';
        cell.classList.remove('potential');
    });

    document.querySelectorAll('.p1-sum, .p2-sum').forEach(c => c.textContent = '0 / 63');
    document.querySelectorAll('.p1-bonus, .p2-bonus').forEach(c => c.textContent = '+ 0');
    document.querySelectorAll('.p1-total, .p2-total').forEach(c => c.textContent = '0');

    document.getElementById('game-over-modal').classList.add('hidden');

    updatePlayerUI();
    startTurnTimer();
}

function switchPlayer() {
    currentPlayer = currentPlayer === 1 ? 2 : 1;

    if (Object.keys(scores[currentPlayer]).length === 13) {
        currentPlayer = currentPlayer === 1 ? 2 : 1;
    }

    rollsLeft = 3;
    hasRolled = false;

    rollsLeftSpan.textContent = rollsLeft;

    heldDice.fill(false);
    diceWrappers.forEach(w => w.classList.remove('held'));

    updatePlayerUI();
    startTurnTimer();
}
window.addEventListener('beforeunload', () => {
    if (conn && conn.open) {
        sendData('DISCONNECT', {});
        conn.close();
    }
    if (peer) {
        peer.destroy();
    }
});

initNetwork();