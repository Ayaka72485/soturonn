// pitch_visualizer.js (patched)
// ----------------------------------------------------
// 音高検出アルゴリズム（AutoCorrelate）と Canvas描画処理
// ----------------------------------------------------

const SCROLL_SPEED_PX_PER_SEC = 200;
const PITCH_TOLERANCE_SEMITONES = 0.6;
const minMidi = 30;
const maxMidi = 70;
const PRACTICE_MODE = {
    MIDI: "midi",        // 厳密
    ORIGINAL: "original" // ノリ許容
};
// ===== BPM（MIDIから取得、なければ120）=====
const BPM = window.midiBPM || 120;
// ===== 判定パラメータ =====
const TIMING_RATIO = 0.125; // ← 12.5%
window.showReferenceBars = true; // ★ お手本音高バー ON/OFF


function getTimingWindowMs() {
    const quarterMs = (60 / BPM) * 1000; // 四分音符(ms)
    return quarterMs * TIMING_RATIO;     // 12.5%
}

function autoCorrelate(buffer) {
    if (!buffer || buffer.length === 0) return -1;
    const SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    const c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++) {
        for (let j = 0; j < SIZE - i; j++) {
            c[i] += buffer[j] * buffer[j + i];
        }
    }
    let d = 0;
    while (c[d] > c[d+1] && d < SIZE-2) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }
    let T0 = maxpos;
    if (T0 <= 0) return -1;

    const sampleRate = (window.audioContext && window.audioContext.sampleRate) ? window.audioContext.sampleRate : 44100;
    const freq = sampleRate / T0;
    if (freq > 20000 || freq < 40) return -1;
    return freq;
}

function frequencyToMidi(f) {
    return Math.round(12 * (Math.log(f / 440) / Math.log(2)) + 69);
}

function midiToNoteName(m) {
    const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const idx = ((m % 12) + 12) % 12;
    return names[idx] + (Math.floor(m/12)-1);
}

function drawBaseline(ctx, canvas) {
    if (!ctx || !canvas) return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = '#eee';
    ctx.beginPath();
    ctx.moveTo(0, canvas.height/2);
    ctx.lineTo(canvas.width, canvas.height/2);
    ctx.stroke();
}

function drawCorrectPitchBars(ctx, canvas, correctNotes, elapsedTime) {
    if (!ctx || !canvas) return 0;

    // ★ OFF時：背景だけ描いて即終了（蓄積防止）
    if (!window.showReferenceBars) {
        drawBaseline(ctx, canvas);
        return 0;
    }

    drawBaseline(ctx, canvas);
    const canvasHeight = canvas.height;
    const canvasWidth = canvas.width;
    const centerLineX = canvasWidth / 2;
    const scrollOffset = elapsedTime * SCROLL_SPEED_PX_PER_SEC;

    ctx.strokeStyle = '#999';
    ctx.beginPath();
    ctx.moveTo(centerLineX, 0);
    ctx.lineTo(centerLineX, canvasHeight);
    ctx.stroke();

    let totalHit = 0;
    const notes = Array.isArray(correctNotes) ? correctNotes : (Array.isArray(window.correctNotes) ? window.correctNotes : []);
    notes.forEach(note => {
        const noteStart = note.startTime;
        const noteEnd = note.startTime + note.duration;
        const isCurrent = elapsedTime >= noteStart && elapsedTime <= noteEnd;

        const startX = (note.startTime * SCROLL_SPEED_PX_PER_SEC) - scrollOffset + centerLineX;
        const width = Math.max(2, note.duration * SCROLL_SPEED_PX_PER_SEC);

        if (startX + width < 0 || startX > canvasWidth) return;

        const normalizedY = 1 - ((note.pitch - minMidi) / (maxMidi - minMidi));
        const barY = normalizedY * (canvasHeight - 60) + 30;

        if (note.hit) {
            ctx.fillStyle = 'rgba(46,204,113, 0.5)';
            totalHit++;
        } else if (isCurrent) {
            ctx.fillStyle = 'rgba(255, 193, 7, 0.8)';
        } else {
            ctx.fillStyle = 'rgba(0, 123, 255, 0.6)';
        }

        ctx.fillRect(startX, barY - 10, width, 20);
    });

    return totalHit;
}

function drawUserPitchLine(ctx, canvas, midi, noteName, elapsedTime, judgeResult){
    if (!ctx || !canvas) return;

    let color = 'rgba(231,76,60, 1)'; // デフォルト：赤（ミス）

    if (judgeResult?.hit) {
        if (judgeResult.timing === "just") {
            color = 'rgba(46,204,113, 1)'; // 緑
        } else if (judgeResult.timing === "groove") {
            color = 'rgba(52,152,219, 1)'; // 青（ノリ）
        } else {
            color = 'rgba(241,196,15, 1)'; // 黄（early / late）
        }
    }

    const canvasHeight = canvas.height;
    const canvasWidth = canvas.width;
    const x = canvasWidth / 2;
    const normalizedY = 1 - ((midi - minMidi) / (maxMidi - minMidi));
    const y = normalizedY * (canvasHeight - 60) + 30;

    ctx.beginPath();
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.moveTo(x - 60, y);
    ctx.lineTo(x + 60, y);
    ctx.stroke();
}


function judgeHit(userMidi, elapsedTime, correctNotes) {
    if (userMidi == null) {
        return { hit: false, timing: "out", pitchDiffCent: null };
    }

    const mode = window.currentPracticeMode; // UIで選ばれたモード
    const timingMs = getTimingWindowMs();    // ★ 四分音符×12.5%

    const notes = Array.isArray(correctNotes)
        ? correctNotes
        : (Array.isArray(window.correctNotes) ? window.correctNotes : []);

    for (let note of notes) {
        if (note.hit) continue;

        const noteCenter = note.startTime + note.duration / 2;
        const deltaMs = (elapsedTime - noteCenter) * 1000;

        // ===== タイミング判定（共通）=====
        if (Math.abs(deltaMs) > timingMs) {
            continue; // 12.5%を超えたら両モード共通でミス
        }

        // ===== モード別の評価ラベル =====
        let timingResult;
        if (mode === PRACTICE_MODE.MIDI) {
            timingResult = "just";
        } else if (mode === PRACTICE_MODE.ORIGINAL) {
            timingResult = "groove";
        }

        // ===== ピッチ判定（cent）=====
        const pitchDiffCent = (userMidi - note.pitch) * 100;

        if (Math.abs(pitchDiffCent) <= 30) {
            note.hit = true;
            return {
                hit: true,
                timing: timingResult,
                pitchDiffCent: pitchDiffCent
            };
        }
    }

    return { hit: false, timing: "out", pitchDiffCent: null };
}

function midiDiffToCent(userMidi, targetMidi) {
    return (userMidi - targetMidi) * 100;
}


// make functions global for other modules
window.autoCorrelate = autoCorrelate;
window.frequencyToMidi = frequencyToMidi;
window.midiToNoteName = midiToNoteName;
window.drawBaseline = drawBaseline;
window.drawCorrectPitchBars = drawCorrectPitchBars;
window.drawUserPitchLine = drawUserPitchLine;
window.judgeHit = judgeHit;
