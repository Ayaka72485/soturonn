// app_main.js
// ----------------------------------------------------
// アプリケーションのエントリーポイントとイベント制御
// ----------------------------------------------------

window.userPitchHistory = [];
window.audioContext = null;
var analyser = null;
var mediaStreamSource = null;
var mediaStream = null; // マイクストリーム保持用
var rafId = null;
var isListening = false;
var startTime = 0;

var startPlayBtn = null, stopPlayBtn = null, rewindBtn = null, forwardBtn = null, timelineSlider = null;
var midiFileInput = null, audioFileInput = null;

// 練習モード定義
window.currentPracticeMode = "midi"; // "midi" or "original"

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    // DOM要素の取得
    startPlayBtn = document.getElementById('startPlayBtn');
    stopPlayBtn  = document.getElementById('stopPlayBtn');
    rewindBtn = document.getElementById('rewindBtn');
    forwardBtn = document.getElementById('forwardBtn');
    timelineSlider = document.getElementById('timelineSlider');
    midiFileInput = document.getElementById('midiFileInput');
    audioFileInput = document.getElementById('audioFileInput');

    // 練習モードUI
    document.querySelectorAll('input[name="practiceMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            window.currentPracticeMode = e.target.value;
            console.log("練習モード切替:", window.currentPracticeMode);
        });
    });

    // 再生ボタン初期状態
    if (startPlayBtn) startPlayBtn.disabled = true;
    if (stopPlayBtn) stopPlayBtn.disabled = true;

    // イベントリスナー
    if (startPlayBtn) startPlayBtn.onclick = startListeningAndPlayback;
    if (stopPlayBtn) stopPlayBtn.onclick = stopListeningAndPlayback;
    if (rewindBtn) rewindBtn.onclick = () => seekTime(-15);
    if (forwardBtn) forwardBtn.onclick = () => seekTime(15);

    if (timelineSlider) {
        timelineSlider.addEventListener('input', handleTimelineSeek);
        timelineSlider.addEventListener('change', handleTimelineSeek);
    }

    if (midiFileInput) midiFileInput.addEventListener('change', handleMidiFileLoad);
    if (audioFileInput) audioFileInput.addEventListener('change', handleAudioFileLoad);

    // 初期描画
    const canvas = document.getElementById('visual');
    const ctx = canvas.getContext('2d');
    drawBaseline(ctx, canvas);
});

// --- MIDIファイルロード ---
function handleMidiFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    const midiStatus = document.getElementById('midiStatus');
    midiStatus.textContent = `ファイルを解析中: ${file.name}...`;

    const reader = new FileReader();
    reader.onload = function(e) {
        parseMidiArrayBuffer(e.target.result);
    };
    reader.onerror = function(e) {
        console.error("FileReaderエラー:", e.target.error);
        midiStatus.textContent = "❌ ファイル読み込みエラーが発生しました。";
    }
    reader.readAsArrayBuffer(file);
}

// --- オーディオファイルロード ---
function handleAudioFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    loadAudioFile(file);
}

// --- 再生ボタン有効化チェック ---
function checkAndEnablePlayback() {
    if (window.isMidiLoaded) {
        if (startPlayBtn) startPlayBtn.disabled = false;
    } else {
        if (startPlayBtn) startPlayBtn.disabled = true;
    }
}
window.checkAndEnablePlayback = checkAndEnablePlayback;

// --- 再生/停止制御 ---
async function startListeningAndPlayback() {
    if (isListening) return;

    if (correctNotes.length === 0) {
        document.getElementById('midiStatus').textContent = "警告：先にMIDIファイルを読み込んでください。";
        return;
    }

    await startListening(); 
    startAudioPlayback(getAudioCurrentTime());
}

function stopListeningAndPlayback() {
    stopListening();
    stopAudioPlayback();
}

// --- マイク入力開始 ---
async function startListening() {
    if (isListening) return;

    try {
    //    await Tone.context.resume();
        window.audioContext = Tone.context;

        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamSource = window.audioContext.createMediaStreamSource(mediaStream);

        analyser = window.audioContext.createAnalyser();
        analyser.fftSize = 2048;

        mediaStreamSource.connect(analyser);

        isListening = true;
        if (startPlayBtn) startPlayBtn.disabled = true;
        if (stopPlayBtn) stopPlayBtn.disabled = false;

        startTime = window.audioContext.currentTime - getAudioCurrentTime();

        updateLoop();
    } catch (err) {
        console.error("マイクまたはAudioContextのエラー:", err);
        document.getElementById('pitch-display').textContent = 'マイクを許可してください';
    }
}

// --- マイク停止 ---
function stopListening() {
    if (!isListening) return;
    isListening = false;

    if (startPlayBtn) startPlayBtn.disabled = false;
    if (stopPlayBtn) stopPlayBtn.disabled = true;

    if (rafId) cancelAnimationFrame(rafId);
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }

    analyser = null;
    mediaStreamSource = null;
    mediaStream = null;

    const canvas = document.getElementById('visual');
    const ctx = canvas.getContext('2d');
    drawCorrectPitchBars(ctx, canvas, correctNotes, getAudioCurrentTime());

    document.getElementById('pitch-display').textContent = '---';
    document.getElementById('freq-display').textContent = '';
}

// --- メインループ ---
function updateLoop() {
    if (!isListening || !analyser || !window.audioContext) return;

    const elapsedTime = getAudioCurrentTime(); 

    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);

    const freq = autoCorrelate(buffer); 

    let userMidi = null;
    let isHit = false;

    const canvas = document.getElementById('visual');
    const ctx = canvas.getContext('2d');

    if (freq !== -1) {
        userMidi = frequencyToMidi(freq);
        const noteName = midiToNoteName(userMidi);

        // 修正: PRACTICE_MODE ではなく currentPracticeMode を使用
        const result = judgeHit(
            userMidi,
            elapsedTime,
            correctNotes,
            window.currentPracticeMode
        );
        isHit = result.hit;

        drawUserPitchLine(ctx, canvas, userMidi, noteName, elapsedTime, isHit);
    } else {
        drawUserPitchLine(ctx, canvas, null, null, elapsedTime, false);
    }

    let totalHit = 0;
    if (SHOW_CORRECT_PITCH_BAR) {
        totalHit = drawCorrectPitchBars(ctx, canvas, correctNotes, elapsedTime);
    }

    updateScore(totalHit, elapsedTime);
    updateUI(elapsedTime);

    if (audioPlayer && elapsedTime >= audioPlayer.buffer.duration - 0.1) {
        stopListeningAndPlayback();
    }

    rafId = requestAnimationFrame(updateLoop);
}

// --- タイムラインシーク ---
function handleTimelineSeek() {
    if (!window.audioContext && !audioPlayer) return;

    const sliderValue = parseFloat(timelineSlider.value);
    const duration = audioPlayer ? audioPlayer.buffer.duration : 0; 

    const seekTimeSec = (sliderValue / 100) * duration;
    setAudioTime(seekTimeSec);

    if (!isListening) {
        const canvas = document.getElementById('visual');
        const ctx = canvas.getContext('2d');
        drawCorrectPitchBars(ctx, canvas, correctNotes, seekTimeSec);
        updateUI(seekTimeSec);
    }
}

function seekTime(deltaSeconds) {
    const currentTime = getAudioCurrentTime();
    const duration = audioPlayer ? audioPlayer.buffer.duration : 0;

    let newTime = currentTime + deltaSeconds;
    if (newTime < 0) newTime = 0;
    if (duration > 0 && newTime >= duration) newTime = duration - 0.1; 

    setAudioTime(newTime);

    if(isListening) {
        startTime = window.audioContext.currentTime - newTime;
    } else {
        const canvas = document.getElementById('visual');
        const ctx = canvas.getContext('2d');
        drawCorrectPitchBars(ctx, canvas, correctNotes, newTime);
        updateUI(newTime);
    }
}

// --- スコア更新 ---
function updateScore(totalHit, elapsedTime) {
    const total = correctNotes.length;
    const pct = total === 0 ? 0 : Math.round((totalHit / total) * 100);

    const duration = audioPlayer ? audioPlayer.buffer.duration : 0;
    document.getElementById('currentTimeDisplay').textContent =
        `${formatTime(elapsedTime)} / ${formatTime(duration)} | スコア: ${pct}%`;
}

// --- UI更新 ---
function updateUI(elapsedTime) {
    const duration = audioPlayer ? audioPlayer.buffer.duration : 0;
    
    if (duration > 0) {
        timelineSlider.value = (elapsedTime / duration) * 100;
    }
}

function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}
