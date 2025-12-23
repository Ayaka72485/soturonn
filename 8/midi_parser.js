// midi_parser.js (patched)
// ----------------------------------------------------
// MIDIファイルの読み込み、ベーストラックの抽出、ノート変換
// ----------------------------------------------------

/**
 * 修正ポイント:
 * - correctNotes と isMidiLoaded を window に格納してグローバルで一貫させる
 * - parseMidiArrayBuffer の例外処理を強化
 * - 解析後に checkAndEnablePlayback() を呼ぶ
 */

window.correctNotes = window.correctNotes || []; // グローバルに1回だけ定義
window.isMidiLoaded = false;

async function parseMidiArrayBuffer(arrayBuffer) {
    window.correctNotes = []; // 初期化
    const midiStatus = document.getElementById('midiStatus');

    try {
        if (!arrayBuffer) throw new Error("ArrayBufferが空です。");

        // Midi ライブラリはバイナリ（ArrayBuffer）を直接受け取れるはず
        const midi = new Midi(arrayBuffer);

        // トラックからベースっぽいトラックを推定するロジック
        let bestTrackNotes = [];
        let bestTrackScore = -Infinity;
        midi.tracks.forEach((track, i) => {
            const trackNameRaw = track.name || "";
            const trackName = (typeof trackNameRaw === 'string') ? trackNameRaw : String(trackNameRaw);

            if (!track.notes || track.notes.length === 0) return;
            if (typeof track.channel === 'number' && track.channel === 9) return; // ドラムチャンネル除外

            const pitches = track.notes.map(n => n.midi).filter(n => typeof n === 'number');
            if (pitches.length === 0) return;

            const minPitch = Math.min(...pitches);
            const maxPitch = Math.max(...pitches);
            const avgPitch = pitches.reduce((a,b)=>a+b,0)/pitches.length;

            let score = 0;
            if (minPitch >= 30 && maxPitch <= 70) score += 5;
            if (trackName.toLowerCase().includes('bass')) score += 10;
            if (avgPitch < 55) score += (55 - avgPitch) * 0.5;
            if (trackName.toLowerCase().includes('guitar') || trackName.toLowerCase().includes('piano')) score -= 5;

            if (score > bestTrackScore) {
                bestTrackScore = score;
                bestTrackNotes = track.notes;
            }
        });

        // ノートを window.correctNotes に格納
        if (!bestTrackNotes || bestTrackNotes.length === 0) {
            throw new Error("ベースノートが抽出されませんでした。別トラックにベースがあるか、MIDIにノート情報が含まれていない可能性があります。");
        }

        bestTrackNotes.forEach(note => {
            // NOTE: Midi.note object -> { midi, time, duration }
            window.correctNotes.push({
                pitch: note.midi,
                startTime: note.time,
                duration: note.duration,
                hit: false
            });
        });

        // 安定のためソート
        window.correctNotes.sort((a,b) => a.startTime - b.startTime);

        // BPMがあれば Tone.Transport に反映
        if (midi.header && Array.isArray(midi.header.tempos) && midi.header.tempos.length > 0) {
            const originalBPM = midi.header.tempos[0].bpm || 120;
            window.originalBPM = originalBPM;
            const bpmInput = document.getElementById('bpmInput');
            if (bpmInput) bpmInput.value = Math.round(originalBPM);
            if (typeof Tone !== 'undefined' && Tone.Transport) {
                Tone.Transport.bpm.value = originalBPM;
            }
        }

        window.isMidiLoaded = true;
        if (midiStatus) midiStatus.textContent = `✅ 解析完了！ベースラインデータが準備できました。（${window.correctNotes.length}音）`;

        console.log("MIDI解析成功: correctNotes count =", window.correctNotes.length);
        if (typeof checkAndEnablePlayback === 'function') checkAndEnablePlayback();

    } catch (err) {
        window.isMidiLoaded = false;
        window.correctNotes = [];
        console.error("MIDI解析エラー:", err);
        if (midiStatus) midiStatus.textContent = `❌ 解析エラー：${err.message}`;
    }
}
window.parseMidiArrayBuffer = parseMidiArrayBuffer;
window.midiBPM = xxx;
