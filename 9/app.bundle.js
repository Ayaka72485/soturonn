/* app.bundle.js
   - pitch_visualizer + midi_parser + audio_manager + bass_audio + app_main を統合
   - グローバル状態は window.* に統一
   - DOM参照は DOMContentLoaded 内にまとめる
*/
/* ---------- WEAK SPOTS (GLOBAL) ---------- */
window.weakSpots = [];
window.userWeakSections = [];
window.userPitchHistory = []; // ★ これを追加！
window.currentMarkIn = null;
window.currentMarkOut = null;


// ==============================
// 苦手箇所データ
// ==============================
const weakData = {
    autoDetected: [],   // 自動ミス検出（既存）
    userMarked: []      // ユーザー指定区間（NEW）
  };
  
  let userMarkInTime = null;

  let showPitchGuide = true;

  // ★ DOM が読み込まれてから設定する
// 変数名を window.showReferenceBars に統一します
window.showReferenceBars = true;
window.showUserHistory = true; // ★追加：履歴表示の初期値

document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("togglePitchGuide");
    if (toggle) {
        // 初期状態を反映
        toggle.checked = window.showReferenceBars;
        
        toggle.addEventListener("change", (e) => {
            window.showReferenceBars = e.target.checked;
            console.log("お手本表示:", window.showReferenceBars);
            
            // 停止中も即座に画面を更新するために描画関数を一度呼ぶ
            const canvas = document.getElementById('visual');
            const ctx = canvas.getContext('2d');
            if (ctx && typeof getAudioCurrentTime === 'function') {
                drawCorrectPitchBars(ctx, canvas, window.correctNotes, getAudioCurrentTime());
            }
        });
    }
    const toggleUserHistory = document.getElementById("toggleUserHistory");
    if (toggleUserHistory) {
        toggleUserHistory.checked = window.showUserHistory;
        toggleUserHistory.addEventListener("change", (e) => {
            window.showUserHistory = e.target.checked;
        });
    }
});
  
 /* ---------- VISUALIZER ---------- */
(function(){
    // このスコープではユーティリティ関数のみ定義
    window.autoCorrelate = function(buffer) {
        if (!buffer || buffer.length === 0) return -1;
        const SIZE = buffer.length;
        let rms = 0;
        for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
        rms = Math.sqrt(rms / SIZE);
        if (rms < 0.01) return -1;
        const c = new Array(SIZE).fill(0);
        for (let i = 0; i < SIZE; i++) {
            for (let j = 0; j < SIZE - i; j++) c[i] += buffer[j]*buffer[j+i];
        }
        let d = 0; while (c[d] > c[d+1] && d < SIZE-2) d++;
        let maxval=-1, maxpos=-1;
        for (let i=d;i<SIZE;i++){ if (c[i]>maxval){ maxval=c[i]; maxpos=i; } }
        const T0 = maxpos;
        if (!T0 || T0<=0) return -1;
        const sampleRate = (window.audioContext && window.audioContext.sampleRate) ? window.audioContext.sampleRate : 44100;
        const freq = sampleRate / T0;
        return (freq > 20000 || freq < 40) ? -1 : freq;
    };

    window.frequencyToMidi = function(f){ return Math.round(12*(Math.log(f/440)/Math.log(2))+69); };
    window.midiToNoteName = function(m){
        const names=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
        return names[((m%12)+12)%12] + (Math.floor(m/12)-1);
    };

    window.getVisualRange = function() {
        if (window.visualMinMidi && window.visualMaxMidi) {
            return { min: window.visualMinMidi, max: window.visualMaxMidi };
        }
        return { min: 30, max: 70 };
    };
})();

/* ---------- MIDI PARSER ---------- */
(function(){
    window.correctNotes = window.correctNotes || [];
    window.isMidiLoaded = false;
  
    async function parseMidiArrayBuffer(arrayBuffer){
      const midiStatus = document.getElementById('midiStatus');
      window.correctNotes = [];
  
      try {
        if (!arrayBuffer) throw new Error("ArrayBuffer が空です");
  
        const midi = new Midi(arrayBuffer);
  
        let bestTrackNotes = [];
        let bestScore = -Infinity;
  
        midi.tracks.forEach(track => {
          if (!track.notes || track.notes.length === 0) return;
          if (track.channel === 9) return;
  
          const pitches = track.notes.map(n => n.midi);
          if (pitches.length === 0) return;
  
          let score = 0;
          const min = Math.min(...pitches);
          const max = Math.max(...pitches);
          const avg = pitches.reduce((a,b)=>a+b,0)/pitches.length;
  
          if (min >= 30 && max <= 70) score += 5;
          if ((track.name || "").toLowerCase().includes("bass")) score += 10;
          if (avg < 55) score += (55 - avg) * 0.5;
  
          if (score > bestScore) {
            bestScore = score;
            bestTrackNotes = track.notes;
          }
        });
  
        if (bestTrackNotes.length === 0) {
          throw new Error("ベーストラックが見つかりませんでした");
        }
  
        bestTrackNotes.forEach(note => {
          window.correctNotes.push({
            pitch: note.midi,
            startTime: note.time,
            duration: note.duration || 0.1,
            hit: false
          });
        });
  
        window.correctNotes.sort((a,b)=>a.startTime-b.startTime);
  
        // ★ 音域をここで確定
        const pitches = window.correctNotes.map(n => n.pitch);
        window.visualMinMidi = Math.min(...pitches) - 2;
        window.visualMaxMidi = Math.max(...pitches) + 2;
  
        // BPM
        if (midi.header.tempos?.length) {
          window.originalBPM = midi.header.tempos[0].bpm;
          const bpmInput = document.getElementById("bpmInput");
          if (bpmInput) bpmInput.value = Math.round(window.originalBPM);
          if (Tone.Transport) Tone.Transport.bpm.value = window.originalBPM;
        }
  
        window.isMidiLoaded = true;
        if (midiStatus) {
          midiStatus.textContent =
            `✅ 解析完了（${window.correctNotes.length} 音）`;
        }
  
        if (typeof checkAndEnablePlayback === "function") {
          checkAndEnablePlayback();
        }
  
        console.log("MIDI解析成功", window.correctNotes.length);
  
      } catch (err) {
        window.isMidiLoaded = false;
        window.correctNotes = [];
        console.error("MIDI解析エラー:", err);
        if (midiStatus) {
          midiStatus.textContent = `❌ ${err.message}`;
        }
      }
    }
  
    window.parseMidiArrayBuffer = parseMidiArrayBuffer;
  })();
  
/* ---------- AUDIO MANAGER ---------- */
(function(){
    let audioPlayer = null;
    window.audioPlayer = window.audioPlayer || null;
    window.originalBPM = window.originalBPM || 120;
    window.isAudioLoaded = window.isAudioLoaded || false;
    let currentPlaybackRate = 1.0;

    async function loadAudioFile(file){
        if (!file) return;
        const audioStatus = document.getElementById('audioStatus');
        if (audioStatus) audioStatus.textContent = `ファイルを読み込み中: ${file.name}...`;
        try{
            if (audioPlayer) audioPlayer.dispose();
            audioPlayer = new Tone.Player({ url: URL.createObjectURL(file), autostart:false }).toDestination();
            window.audioPlayer = audioPlayer;
            await audioPlayer.loaded;
            window.isAudioLoaded = true;
            const masterVolSlider = document.getElementById('masterVolumeSlider');
            const initialVol = masterVolSlider ? parseFloat(masterVolSlider.value) : 50;
            if (audioPlayer && typeof audioPlayer.volume !== 'undefined') audioPlayer.volume.value = Tone.gainToDb(initialVol/100);
            if (audioStatus) audioStatus.textContent = `✅ 原曲のロードが完了しました。（長さ: ${audioPlayer.buffer.duration.toFixed(1)}秒）`;
            if (typeof checkAndEnablePlayback === 'function') checkAndEnablePlayback();
        }catch(err){
            window.isAudioLoaded = false;
            console.error("原曲のロードエラー:", err);
            if (audioStatus) audioStatus.textContent = `❌ 原曲のロードに失敗しました。`;
        }
    }
    window.loadAudioFile = loadAudioFile;

    function startAudioPlayback(timeOffset = 0){
        if (!audioPlayer || !audioPlayer.loaded) return;
        Tone.Transport.start();
        audioPlayer.start(0, timeOffset);
    }
    window.startAudioPlayback = startAudioPlayback;

    function stopAudioPlayback(){
        Tone.Transport.stop();
        if (audioPlayer) audioPlayer.stop();
    }
    window.stopAudioPlayback = stopAudioPlayback;

    function getAudioCurrentTime(){ return Tone.Transport.seconds; }
    window.getAudioCurrentTime = getAudioCurrentTime;

    function setAudioTime(seconds){
        if (typeof Tone !== 'undefined' && Tone.Transport) Tone.Transport.seconds = seconds;
        if (audioPlayer) { audioPlayer.stop(); audioPlayer.start(0, seconds); }
    }
    window.setAudioTime = setAudioTime;

})();

/* ---------- BASS AUDIO ---------- */
(function(){
    const bassSynth = new Tone.MonoSynth({
        oscillator: { type: "square" },
        filter: { Q: 1, type: "lowpass" },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.5 }
    }).toDestination();

    function playMidiBass() {
        if (!window.correctNotes || window.correctNotes.length === 0) {
            console.warn("correctNotes が空です。MIDI を読み込んでください。");
            return;
        }

        Tone.Transport.cancel();
        Tone.Transport.position = 0;

        window.correctNotes.forEach(note => {
            Tone.Transport.schedule(time => {
                const freq = Tone.Frequency(note.pitch, "midi").toFrequency();
                bassSynth.triggerAttackRelease(freq, note.duration, time);
            }, note.startTime);
        });

        Tone.Transport.start();
    }

    function stopMidiBass() {
        Tone.Transport.stop();
        Tone.Transport.cancel();
    }

    window.playMidiBass = playMidiBass;
    window.stopMidiBass = stopMidiBass;
})();


/* ---------- WEAK SPOT RECORDER ---------- */
(function(){

    function getTimingToleranceMs(bpm, mode){
      if (mode === "midi") {
        const quarterMs = (60 / bpm) * 1000;
        return quarterMs * 0.125; // 12.5%
      } else {
        return 40; // original モードは固定
      }
    }
  
    window.recordWeakSpot = function({
      timeSec,
      targetMidi,
      userMidi,
      pitchDiffCent,
      timingDiffMs,
      bpm,
      mode
    }) {
      const pitchTol = 30;
      const timingTol = getTimingToleranceMs(bpm, mode);
  
      const reasons = [];
      if (Math.abs(pitchDiffCent) > pitchTol) reasons.push("音高");
      if (Math.abs(timingDiffMs) > timingTol) reasons.push("タイミング");
  
      if (reasons.length === 0) return;
  
      window.weakSpots.push({
        timeSec,
        targetMidi,
        userMidi,
        pitchDiffCent,
        timingDiffMs,
        bpm,
        mode,
        reasons
      });
  
      updateWeakSpotsUI();
    };
  
    window.updateWeakSpotsUI = function(){
      const list = document.getElementById("weakSpotsList");
      if (!list) return;
  
      if (window.weakSpots.length === 0) {
        list.textContent = "現在登録されている苦手箇所はありません。";
        return;
      }
  
      list.innerHTML = "";
  
      window.weakSpots.forEach((s, i) => {
        const div = document.createElement("div");
        div.className = "mb-2 p-2 border rounded bg-white text-xs";
  
        div.innerHTML = `
          <div><strong>#${i+1}</strong> ${s.timeSec.toFixed(2)} 秒</div>
          <div>音高誤差: ${s.pitchDiffCent.toFixed(1)} cent</div>
          <div>タイミング誤差: ${s.timingDiffMs.toFixed(1)} ms</div>
          <div>原因: ${s.reasons.join(" / ")}</div>
        `;
  
        list.appendChild(div);
      });
    };
  
  })();

  /* ---------- WEAK SECTION (IN / OUT) ---------- */
// ★追加
(function(){

    window.markIn = function(){
      if (typeof getAudioCurrentTime !== "function") return;
      window.currentMarkIn = getAudioCurrentTime();
      alert(`IN 設定: ${window.currentMarkIn.toFixed(2)} 秒`);
    };
  
    window.markOut = function(){
      if (typeof getAudioCurrentTime !== "function") return;
      if (window.currentMarkIn == null) {
        alert("先に IN を押してください");
        return;
      }
  
      window.currentMarkOut = getAudioCurrentTime();
  
      if (window.currentMarkOut <= window.currentMarkIn) {
        alert("OUT は IN より後にしてください");
        return;
      }
  
      window.userWeakSections.push({
        in: window.currentMarkIn,
        out: window.currentMarkOut
      });
  
      window.currentMarkIn = null;
      window.currentMarkOut = null;
  
      updateWeakSectionsUI();
    };
  
    window.updateWeakSectionsUI = function(){
      const list = document.getElementById("weakSectionsList");
      if (!list) return;
  
      if (window.userWeakSections.length === 0) {
        list.textContent = "登録された苦手区間はありません。";
        return;
      }
  
      list.innerHTML = "";
  
      window.userWeakSections.forEach((sec, i) => {
        const div = document.createElement("div");
        div.className = "mb-2 p-2 border rounded text-xs bg-white";
        div.textContent =
          `#${i+1} ${sec.in.toFixed(2)}s → ${sec.out.toFixed(2)}s`;
        list.appendChild(div);
      });
    };
  
  })();


  /* ---------- APP MAIN (完全版：描画ロジック統合) ---------- */
(function(){
    const SCROLL_SPEED = 200;
    window.audioContext = window.audioContext || null;
    let analyser=null, mediaStreamSource=null, rafId=null, isListening=false, startTime=0;
    let startPlayBtn, stopPlayBtn, rewindBtn, forwardBtn, timelineSlider, canvas, ctx;

    document.addEventListener('DOMContentLoaded', ()=>{
        startPlayBtn = document.getElementById('startPlayBtn');
        stopPlayBtn  = document.getElementById('stopPlayBtn');
        rewindBtn = document.getElementById('rewindBtn');
        forwardBtn = document.getElementById('forwardBtn');
        timelineSlider = document.getElementById('timelineSlider');
        canvas = document.getElementById('visual');
        ctx = canvas ? canvas.getContext('2d') : null;

        if (startPlayBtn) startPlayBtn.onclick = startListeningAndPlayback;
        if (stopPlayBtn) stopPlayBtn.onclick = stopListeningAndPlayback;
        
        // ファイル入力等の紐付け
        document.getElementById('midiFileInput')?.addEventListener('change', handleMidiFileLoad);
        document.getElementById('audioFileInput')?.addEventListener('change', handleAudioFileLoad);
        
        if (ctx) drawBaseline();
    });

    // --- 描画関数群 ---
    function drawBaseline() {
        if (!ctx) return;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.strokeStyle='#eee';
        ctx.beginPath(); ctx.moveTo(0,canvas.height/2); ctx.lineTo(canvas.width,canvas.height/2); ctx.stroke();
    }

    function drawCorrectPitchBars(elapsedTime) {
        if (!ctx || window.showReferenceBars === false) return;
        const centerX = canvas.width / 2;
        const scrollOffset = elapsedTime * SCROLL_SPEED;
        const { min, max } = window.getVisualRange();

        ctx.strokeStyle='#999'; ctx.beginPath(); ctx.moveTo(centerX,0); ctx.lineTo(centerX,canvas.height); ctx.stroke();

        (window.correctNotes || []).forEach(note => {
            const startX = (note.startTime * SCROLL_SPEED) - scrollOffset + centerX;
            const width = Math.max(2, (note.duration || 0.1) * SCROLL_SPEED);
            if (startX + width < 0 || startX > canvas.width) return;

            const normalizedY = 1 - ((note.pitch - min) / (max - min));
            const y = normalizedY * (canvas.height - 60) + 30;

            ctx.fillStyle = note.hit ? 'rgba(46,204,113,0.5)' : 
                           (elapsedTime >= note.startTime && elapsedTime <= note.startTime + note.duration) ? 
                           'rgba(255,193,7,0.8)' : 'rgba(0,123,255,0.6)';
            ctx.fillRect(startX, y-10, width, 20);
        });
    }

    function drawUserPitchHistory(elapsedTime) {
        if (!ctx || window.showUserHistory === false || !window.userPitchHistory) return;
        const centerX = canvas.width / 2;
        const scrollOffset = elapsedTime * SCROLL_SPEED;
        const { min, max } = window.getVisualRange();

        window.userPitchHistory.forEach(point => {
            const x = (point.time * SCROLL_SPEED) - scrollOffset + centerX;
            if (x < 0 || x > canvas.width) return;
            const normalizedY = 1 - ((point.midi - min) / (max - min));
            const y = normalizedY * (canvas.height - 60) + 30;
            ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2);
            ctx.fillStyle = point.isHit ? '#2ecc71' : '#e74c3c';
            ctx.fill();
        });
    }

    // --- メインループ ---
    function updateLoop(){
        if (!isListening) return;
        // startTime を使って「今、曲の何秒目か」を計算
        const elapsedTime = window.audioContext.currentTime - startTime;

        drawBaseline();
        drawCorrectPitchBars(elapsedTime);
        drawUserPitchHistory(elapsedTime);

        if (analyser) {
            const buffer = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(buffer);
            const freq = window.autoCorrelate(buffer);
            const midi = (freq > 0) ? window.frequencyToMidi(freq) : null;
            
            if (midi !== null) {
                const result = judgeHit(midi, elapsedTime, window.correctNotes);
                window.userPitchHistory.push({ time: elapsedTime, midi: midi, isHit: result.hit });
                // 今の音を太線で描画
                const { min, max } = window.getVisualRange();
                const y = (1 - ((midi - min) / (max - min))) * (canvas.height - 60) + 30;
                ctx.beginPath(); ctx.lineWidth=6;
                ctx.strokeStyle = result.hit ? '#2ecc71' : '#e74c3c';
                ctx.moveTo(canvas.width/2 - 60, y); ctx.lineTo(canvas.width/2 + 60, y); ctx.stroke();
            }
        }

        // タイムライン更新
        if (timelineSlider && window.audioPlayer?.buffer) {
            timelineSlider.value = (elapsedTime / window.audioPlayer.buffer.duration) * 100;
        }
        rafId = requestAnimationFrame(updateLoop);
    }

    async function startListeningAndPlayback(){
        if (isListening || !window.isMidiLoaded) return;
        if (!window.audioContext) window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await Tone.context.resume();

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamSource = window.audioContext.createMediaStreamSource(stream);
        analyser = window.audioContext.createAnalyser();
        analyser.fftSize = 2048;
        mediaStreamSource.connect(analyser);

        isListening = true;
        // 開始位置を取得して startTime を固定
        const currentPos = (typeof getAudioCurrentTime === 'function') ? getAudioCurrentTime() : 0;
        startTime = window.audioContext.currentTime - currentPos;

        updateLoop();
        if (typeof startAudioPlayback === 'function') startAudioPlayback(currentPos);
        if (typeof playMidiBass === 'function') playMidiBass();
    }

    function stopListeningAndPlayback(){
        isListening = false;
        if (rafId) cancelAnimationFrame(rafId);
        if (mediaStreamSource) mediaStreamSource.mediaStream.getTracks().forEach(t => t.stop());
        if (typeof stopAudioPlayback === 'function') stopAudioPlayback();
        if (typeof stopMidiBass === 'function') stopMidiBass();
    }

    function handleMidiFileLoad(event){
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => { parseMidiArrayBuffer(e.target.result); checkAndEnablePlayback(); };
        reader.readAsArrayBuffer(file);
    }

    function handleAudioFileLoad(event){
        const file = event.target.files[0];
        if (file) loadAudioFile(file);
    }

    function checkAndEnablePlayback(){
        if (startPlayBtn) startPlayBtn.disabled = !window.isMidiLoaded;
    }

    function handleTimelineSeek(event){
        const duration = window.audioPlayer?.buffer?.duration || 0;
        if (duration > 0) {
            const seekPos = (parseFloat(event.target.value) / 100) * duration;
            setAudioTime(seekPos);
            // 停止中も描画を更新
            if (!isListening) {
                drawBaseline();
                drawCorrectPitchBars(seekPos);
            }
        }
    }
})();