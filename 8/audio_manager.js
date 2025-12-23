// --- audio_manager.js（修正版：DOMアクセスをDOMContentLoadedの中へ） ---
let audioPlayer = null;
window.originalBPM = 120;
let currentPlaybackRate = 1.0;
window.isAudioLoaded = false;

// loadAudioFile はそのまま（変更なし）
async function loadAudioFile(file) {
    if (!file) return;
    const audioStatus = document.getElementById('audioStatus');
    if (audioStatus) audioStatus.textContent = `ファイルを読み込み中: ${file.name}...`;

    try {
        if (audioPlayer) audioPlayer.dispose();

        audioPlayer = new Tone.Player({
            url: URL.createObjectURL(file),
            autostart: false,
        }).toDestination();
        window.audioPlayer = audioPlayer;

        await audioPlayer.loaded;
        window.isAudioLoaded = true;

        // ボリューム設定を初期化（DOM要素はここで安全に取得）
        const masterVolumeSliderLocal = document.getElementById('masterVolumeSlider');
        const initialVol = masterVolumeSliderLocal ? parseFloat(masterVolumeSliderLocal.value) : 50;
        if (audioPlayer && typeof audioPlayer.volume !== 'undefined') {
            audioPlayer.volume.value = Tone.gainToDb(initialVol / 100);
        }

        if (audioStatus) audioStatus.textContent = `✅ 原曲のロードが完了しました。（長さ: ${audioPlayer.buffer.duration.toFixed(1)}秒）`;

        if (typeof checkAndEnablePlayback === 'function') {
            checkAndEnablePlayback();
        }

    } catch (err) {
        window.isAudioLoaded = false;
        console.error("原曲のロードエラー:", err);
        if (audioStatus) audioStatus.textContent = `❌ 原曲のロードに失敗しました。ファイル形式を確認してください。`;
    }
}
window.loadAudioFile = loadAudioFile;

// DOM操作をDOMContentLoaded内にまとめる（重複と null を防ぐ）
document.addEventListener('DOMContentLoaded', () => {
    const bpmInput = document.getElementById('bpmInput');
    const setBpmBtn = document.getElementById('setBpmBtn');
    if (setBpmBtn && bpmInput) {
        setBpmBtn.addEventListener('click', () => {
            const newBPM = parseFloat(bpmInput.value);
            if (isNaN(newBPM) || newBPM < 40 || newBPM > 300) {
                alert("BPMは40から300の間の数値で設定してください。");
                return;
            }
            if (typeof Tone !== 'undefined' && Tone.Transport) Tone.Transport.bpm.value = newBPM;
            if (window.originalBPM && audioPlayer) {
                currentPlaybackRate = newBPM / window.originalBPM;
                audioPlayer.set({ playbackRate: currentPlaybackRate });
            }
        });
    }

    const masterVolumeSlider = document.getElementById('masterVolumeSlider');
    const masterVolumeLabel = document.getElementById('masterVolumeLabel');
    if (masterVolumeSlider) {
        masterVolumeSlider.addEventListener('input', () => {
            const vol = parseFloat(masterVolumeSlider.value);
            if (masterVolumeLabel) masterVolumeLabel.textContent = vol;
            if (audioPlayer) {
                audioPlayer.volume.value = Tone.gainToDb(vol / 100);
            }
        });
    }
});

// 再生制御関数はそのまま
function startAudioPlayback(timeOffset = 0){
    if (!audioPlayer || !audioPlayer.loaded) return;
    // Transport に Player を同期して再生
    audioPlayer.sync().start(timeOffset);
    Tone.Transport.start();
}

function stopAudioPlayback(){
    Tone.Transport.stop();
    if (audioPlayer){
        audioPlayer.stop();
        audioPlayer.unsync();
    }
}

function getAudioCurrentTime() {
    return Tone.Transport.seconds;
}
window.getAudioCurrentTime = getAudioCurrentTime;

function setAudioTime(seconds) {
    Tone.Transport.seconds = seconds;
    if (audioPlayer) {
        audioPlayer.stop();
        audioPlayer.start(0, seconds);
    }
}
window.setAudioTime = setAudioTime;
