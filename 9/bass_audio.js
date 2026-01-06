// ------------------------------------------------------------
// bass_audio.js
// MIDIベースラインを MonoSynth で再生するモジュール
// ------------------------------------------------------------

// 単純なベース音のための MonoSynth を作成
const bassSynth = new Tone.MonoSynth({
    oscillator: {
        type: "square"  // ベースっぽい太い音
    },
    filter: {
        Q: 1,
        type: "lowpass"
    },
    envelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.4,
        release: 0.5
    }
}).toDestination();

/**
 * MIDIベースノートを再生
 * correctNotes[] を使用
 */
function playMidiBass() {
    if (!window.correctNotes || window.correctNotes.length === 0) {
        console.warn("correctNotes が空です。MIDI を読み込んでください。");
        return;
    }

    Tone.Transport.cancel();
    Tone.Transport.position = 0;

    window.correctNotes.forEach(note => {
        Tone.Transport.schedule(time => {
            // pitch は MIDI番号なので note.midi → "C2" に変換
            const freq = Tone.Frequency(note.pitch, "midi").toFrequency();
            bassSynth.triggerAttackRelease(freq, note.duration, time);
        }, note.startTime);
    });

    Tone.Transport.start();
}

/**
 * 再生停止
 */
function stopMidiBass() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
}

window.playMidiBass = playMidiBass;
window.stopMidiBass = stopMidiBass;
