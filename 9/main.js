let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let rafId = null;
let isRunning = false;
let correctNotes = []; // MIDIファイルから抽出された演奏データ（正解データ）
let startTime = 0; // 実行中の時刻を管理する変数

// --- DOM要素の宣言（ここではnullで初期化） ---
let startButton, stopButton, pitchDisplay, freqDisplay, canvas, ctx;
let midiFileInput, midiStatus;

// --- 初期化処理（DOMContentLoaded内へすべて移動） ---
document.addEventListener('DOMContentLoaded', () => {
    // すべてのDOM要素の取得をここで行う (エラー回避)
    startButton = document.getElementById('startButton');
    stopButton  = document.getElementById('stopButton');
    pitchDisplay = document.getElementById('pitch-display');
    freqDisplay = document.getElementById('freq-display');
    canvas = document.getElementById('visual');
    ctx = canvas.getContext('2d');
    midiFileInput = document.getElementById('midiFileInput');
    midiStatus = document.getElementById('midiStatus');

    // イベントリスナーの設定
    if (startButton) startButton.onclick = startListening;
    if (stopButton) stopButton.onclick = stopListening;

    // ファイル選択時のイベントリスナーを設定
    if (midiFileInput) {
        midiFileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                midiStatus.textContent = `ファイルを解析中: ${file.name}...`;
                
                const reader = new FileReader();
                reader.onload = function(e) {
                    const arrayBuffer = e.target.result;
                    parseMidiArrayBuffer(arrayBuffer); // 解析関数を呼び出す
                };
                reader.onerror = function(e) {
                    console.error("FileReaderエラー:", e.target.error);
                    midiStatus.textContent = "❌ ファイル読み込みエラーが発生しました。";
                }
                reader.readAsArrayBuffer(file);
            } else {
                midiStatus.textContent = "MIDIファイルを読み込んでください...";
            }
        });
    }

    // 最初にキャンバスのベースラインを描画
    drawBaseline();
});

// --- マイク入力の開始・停止機能 ---
async function startListening() {
    if (isRunning) return;
    // MIDIデータがない場合はアラートで警告 (alert()の代わりにカスタムメッセージを使用することを推奨)
    if (correctNotes.length === 0) {
        midiStatus.textContent = "警告：先にMIDIファイルを読み込んでください。";
        return;
    }
    
    try {
        // ★修正点 1: Tone.jsのContextも確実に再開する
        // Tone.js context を流用
        audioContext = Tone.context;   // Tone.js と同じ context を使う
        await resumeIfNeeded(audioContext);


        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamSource = audioContext.createMediaStreamSource(stream);

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        mediaStreamSource.connect(analyser);

        isRunning = true;
        startButton.disabled = true;
        stopButton.disabled = false;
        
        startTime = audioContext.currentTime; // 開始時刻を設定

        clearCanvas();
        updatePitch();
    } catch (err) {
        console.error("マイクまたはAudioContextのエラー:", err);
        pitchDisplay.textContent = 'マイクを許可してください';
    }
}

function stopListening() {
    if (!isRunning) return;
    isRunning = false;
    startButton.disabled = false;
    stopButton.disabled = true;

    if (rafId) cancelAnimationFrame(rafId);
    if (mediaStreamSource?.mediaStream) {
        mediaStreamSource.mediaStream.getTracks().forEach(t => t.stop());
    }
    if (audioContext && audioContext.state !== 'closed') audioContext.close();

    analyser = null;
    mediaStreamSource = null;
    audioContext = null;
    startTime = 0; // 開始時刻をリセット

    pitchDisplay.textContent = '---';
    freqDisplay.textContent = '';
    clearCanvas();
    drawBaseline();
}

// --- 音高検出アルゴリズム (変更なし) ---
function autoCorrelate(buffer, sampleRate) {
    let SIZE = buffer.length;
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

    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }
    let T0 = maxpos;
    if (T0 <= 0) return -1;

    const freq = audioContext.sampleRate / T0;
    if (freq > 20000 || freq < 40) return -1; 
    return freq;
}

// --- ピッチ更新と描画 ---
function updatePitch() {
    if (!isRunning || !analyser) return;

    const elapsedTime = audioContext.currentTime - startTime; // 経過時間（秒）

    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    const freq = autoCorrelate(buffer, audioContext.sampleRate);

    if (freq !== -1) {
        const midi = frequencyToMidi(freq);
        const note = midiToNoteName(midi);
        pitchDisplay.textContent = note;
        freqDisplay.textContent = `${freq.toFixed(1)} Hz (MIDI ${midi})`;
        drawPitch(midi, note, elapsedTime);
    } else {
        pitchDisplay.textContent = '---';
        freqDisplay.textContent = '';
        drawPitch(null, null, elapsedTime);
    }
    
    // 正解バーを時間の流れに合わせて描画するロジックを統合
    drawCorrectPitchBars(elapsedTime); 
    
    rafId = requestAnimationFrame(updatePitch);
}

// --- ユーティリティ（周波数とMIDIの変換） ---
function frequencyToMidi(f) {
    return Math.round(12 * (Math.log(f / 440) / Math.log(2)) + 69);
}
function midiToNoteName(m) {
    const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    return names[m % 12] + (Math.floor(m/12)-1);
}

// --- 描画ユーティリティ ---
function clearCanvas() { ctx.clearRect(0,0,canvas.width,canvas.height); }
function drawBaseline() {
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = '#eee'; ctx.beginPath();
    ctx.moveTo(0, canvas.height/2); ctx.lineTo(canvas.width, canvas.height/2); ctx.stroke();
}

function drawPitch(midi, note, elapsedTime) {
    // ユーザー演奏の音高を横線で表示 
    if (!midi) return;
    
    const minMidi = 30; // ベースの最低音
    const maxMidi = 70; // ベースの最高音
    
    const normalizedY = 1 - ((midi - minMidi) / (maxMidi - minMidi)); 
    const barY = normalizedY * (canvas.height - 40) + 20;

    ctx.fillStyle='rgba(76, 175, 80, 0.7)'; // 緑色
    ctx.fillRect(0, barY - 4, canvas.width, 8); 

    ctx.fillStyle='#222'; ctx.font='20px sans-serif';
    ctx.fillText(note, 20, barY - 10); 
}

// --- 正解バーの描画 (ダミー/タイムラインなし) ---
const SCROLL_SPEED_PX_PER_SEC = 200; // 1秒間に200ピクセル流れる

function drawCorrectPitchBars(elapsedTime) {
    clearCanvas(); 
    drawBaseline();
    
    const minMidi = 30; 
    const maxMidi = 70; 
    const canvasHeight = canvas.height;
    const canvasWidth = canvas.width;
    
    // スクロール量の計算 (時間が進むほど左へスクロール)
    const scrollOffset = elapsedTime * SCROLL_SPEED_PX_PER_SEC; 
    
    // correctNotes配列をループして描画
    correctNotes.forEach(note => {
        
        // スタート位置 (X座標): ノートの開始時間からスクロール量を引く
        const startX = (note.startTime * SCROLL_SPEED_PX_PER_SEC) - scrollOffset; 
        
        // 幅 (ピクセル): ノートの持続時間 * スクロール速度
        const width = note.duration * SCROLL_SPEED_PX_PER_SEC; 
        
        // 画面外に出ていたら描画しない
        if (startX + width < 0 || startX > canvasWidth) return;

        // Y座標の計算
        const normalizedY = 1 - ((note.pitch - minMidi) / (maxMidi - minMidi)); 
        const barY = normalizedY * (canvasHeight - 40) + 20;

        // 正解バーを描画
        ctx.fillStyle = 'rgba(0, 123, 255, 0.5)'; // 青色
        ctx.fillRect(startX, barY - 10, width, 20); 
        
        // デバッグ用: ノート番号を表示
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        // ctx.fillText(note.pitch, startX + 5, barY + 5); 
    });
}

async function resumeIfNeeded(ctx) {
    if (ctx.state==='suspended') await ctx.resume();
}


// --- MIDI解析機能 ---
/**
 * ArrayBufferを受け取り、MIDIデータを解析して演奏データに変換する
 */
async function parseMidiArrayBuffer(arrayBuffer) {
    correctNotes = []; 
    
    try {
        const midi = new Midi(arrayBuffer); 

        // トラック名デコード（Shift-JIS）用のユーティリティ
        const decoder = new TextDecoder("shift_jis");
        
        // --- トラックのフィルタリングとノート抽出 ---
        let notesFound = 0;
        let bestTrackNotes = []; // 最もベースに近いと推定されたトラックのノートを保持
        let bestTrackScore = -Infinity;
        
        midi.tracks.forEach((track, i) => {
            // トラック名のデコードを試みる
            let trackName = track.name || "";
            try {
                const encoded = new TextEncoder().encode(trackName);
                trackName = decoder.decode(encoded);
            } catch (e) {
                // デコード失敗の場合は元の名前をそのまま使う
            }
            
            // ------------------------------------------
            // ★ベーストラック推定ロジックの強化（コア修正）★
            // ------------------------------------------
            
            // 1. ノートが存在しない、またはドラムトラックならスキップ
            if (track.notes.length === 0 || track.channel === 9) return; 

            // 2. ピッチレンジ（音域）を計算
            const pitches = track.notes.map(n => n.midi);
            if (pitches.length === 0) return;

            const minPitch = Math.min(...pitches);
            const maxPitch = Math.max(...pitches);
            const avgPitch = pitches.reduce((sum, p) => sum + p, 0) / pitches.length;

            // ベースの理想的な音域: MIDI 30 (E0/F#0) - 60 (C4/中央C) 
            const idealLowPitch = 35; 
            const idealHighPitch = 65; 
            
            let score = 0;

            // 3. スコアリングの要素
            
            // A. 音域がベース帯域に近いほど高得点 (35-65の範囲内なら加点)
            if (minPitch >= 30 && maxPitch <= 70) score += 5; 
            
            // B. トラック名に 'bass' が含まれるなら大きく加点 (文字化け時も'b*a*s*s'のパターンは稀にあるが、主に英語環境用)
            if (trackName.toLowerCase().includes('bass')) score += 10; 
            
            // C. 平均ピッチが中央より低いほど加点 (ベースの特性)
            if (avgPitch < 55) score += (55 - avgPitch) * 0.5;

            // D. トラックに 'guitar' や 'piano' が含まれていたら減点
            if (trackName.toLowerCase().includes('guitar') || trackName.toLowerCase().includes('piano')) score -= 5;
            
            
            // 4. 最もスコアの高いトラックを選択
            if (score > bestTrackScore) {
                bestTrackScore = score;
                bestTrackNotes = track.notes;
                console.log(`推定ベーストラック変更: トラック ${i} (${trackName}), スコア: ${score.toFixed(1)}`);
            }
        });


        // --- エラーチェックと最終処理 ---
        
        // 最もスコアが高かったトラックのノートを correctNotes に格納
        bestTrackNotes.forEach(note => {
            correctNotes.push({
                pitch: note.midi,
                startTime: note.time,
                duration: note.duration,
            });
            notesFound++;
        });

        if (notesFound === 0) {
            throw new Error("ベースノートが抽出されませんでした。ファイルに有効なノート情報がない可能性があります。");
        }
        
        // 時間の早い順にソート（必須ではないが、描画が安定する）
        correctNotes.sort((a, b) => a.startTime - b.startTime);
        
        // --- 文字化け対策（タイトル表示の削除） ---
        // 文字化けは修正できないため、タイトル表示を非表示にする
        const titleElement = document.getElementById('midiTitle');
        if (titleElement) titleElement.style.display = 'none'; 
        // ----------------------------------------
        
        midiStatus.textContent = `✅ 解析完了！ベースラインデータが準備できました。（${correctNotes.length}音）`;
        
        // 解析完了後、開始ボタンを有効化
        startButton.disabled = false;
        
        console.log("抽出されたベースノート:", correctNotes);


    } catch (error) {
        console.error("致命的な解析エラーが発生しました。MIDIファイルを確認してください。", error);
        
        // エラーメッセージをより具体的に表示
        if (error instanceof TypeError) {
             midiStatus.textContent = "❌ 解析エラー：ファイル形式が不正です。 (.midファイルか確認)";
        } else if (error.message.includes("ノートが抽出されませんでした")) {
             midiStatus.textContent = "❌ 解析エラー：ベーストラックが見つかりません。";
        } else {
            midiStatus.textContent = `❌ 解析エラー：${error.message}`;
        }
    }
}

// 以前の extractBaseNotes は Tone.js の機能と重複するため、削除する
function extractBaseNotes() {
    console.warn("extractBaseNotes関数はTone.jsの導入により使用されなくなりました。");
}
