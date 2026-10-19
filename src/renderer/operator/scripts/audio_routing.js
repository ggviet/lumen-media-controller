        // ==================== DUAL AUDIO ROUTING & MONITORING ====================
        let isPrimingAudio = false;
        let audioDeviceDebounceTimer = null;

        function updateAudioIsolationWarning() {
            if (!audioIsolationWarning || !audioSinkSelect || !cueAudioSinkSelect) return;
            const masterVal = audioSinkSelect.value;
            const cueVal = cueAudioSinkSelect.value;
            if (masterVal && cueVal && masterVal === cueVal) {
                audioIsolationWarning.style.display = 'block';
            } else {
                audioIsolationWarning.style.display = 'none';
            }
        }

        async function primeAudioPermissions() {
            if (isPrimingAudio || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
            isPrimingAudio = true;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
            } catch (err) {
                console.warn('Ephemeral audio permission priming failed/denied:', err);
            } finally {
                isPrimingAudio = false;
            }
        }

        async function populateAudioSinks() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
            try {
                let devices = await navigator.mediaDevices.enumerateDevices();
                let audioOutputs = devices.filter(d => d.kind === 'audiooutput');

                const hasEmptyLabels = audioOutputs.some(d => !d.label || d.label.trim().length === 0);
                if (hasEmptyLabels && navigator.mediaDevices.getUserMedia) {
                    await primeAudioPermissions();
                    devices = await navigator.mediaDevices.enumerateDevices();
                    audioOutputs = devices.filter(d => d.kind === 'audiooutput');
                }

                const savedMasterSink = localStorage.getItem('lumen_master_audio_sink_id') || '';
                const savedCueSink = localStorage.getItem('lumen_cue_audio_sink_id') || '';

                const currentMasterVal = (audioSinkSelect && audioSinkSelect.value) ? audioSinkSelect.value : savedMasterSink;
                const currentCueVal = (cueAudioSinkSelect && cueAudioSinkSelect.value) ? cueAudioSinkSelect.value : savedCueSink;

                if (audioSinkSelect) {
                    audioSinkSelect.innerHTML = '<option value="">Default System Audio</option>';
                }
                if (cueAudioSinkSelect) {
                    cueAudioSinkSelect.innerHTML = '<option value="">Default System Audio</option>';
                }

                audioOutputs.forEach((device, idx) => {
                    const label = device.label || `Audio Output ${idx + 1}`;
                    if (audioSinkSelect) {
                        const opt = document.createElement('option');
                        opt.value = device.deviceId;
                        opt.innerText = label;
                        audioSinkSelect.appendChild(opt);
                    }
                    if (cueAudioSinkSelect) {
                        const opt = document.createElement('option');
                        opt.value = device.deviceId;
                        opt.innerText = label;
                        cueAudioSinkSelect.appendChild(opt);
                    }
                });

                if (audioSinkSelect) {
                    const masterExists = Array.from(audioSinkSelect.options).some(o => o.value === currentMasterVal);
                    if (masterExists && currentMasterVal) {
                        audioSinkSelect.value = currentMasterVal;
                    } else {
                        audioSinkSelect.value = '';
                        if (savedMasterSink && !masterExists) {
                            localStorage.setItem('lumen_master_audio_sink_id', '');
                            ipcRenderer.send('stage-control', 'SET_AUDIO_SINK', { sinkId: '' });
                        }
                    }
                }

                if (cueAudioSinkSelect) {
                    const cueExists = Array.from(cueAudioSinkSelect.options).some(o => o.value === currentCueVal);
                    if (cueExists && currentCueVal) {
                        cueAudioSinkSelect.value = currentCueVal;
                    } else {
                        cueAudioSinkSelect.value = '';
                        if (savedCueSink && !cueExists) {
                            localStorage.setItem('lumen_cue_audio_sink_id', '');
                            const pvwVid = pvwContainer ? pvwContainer.querySelector('video') : null;
                            if (pvwVid && typeof pvwVid.setSinkId === 'function') {
                                pvwVid.setSinkId('').catch(console.warn);
                            }
                        }
                    }
                }

                updateAudioIsolationWarning();
            } catch (err) {
                console.warn('Enumerate audio devices error:', err);
            }
        }
        populateAudioSinks();

        if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
            navigator.mediaDevices.addEventListener('devicechange', () => {
                if (audioDeviceDebounceTimer) clearTimeout(audioDeviceDebounceTimer);
                audioDeviceDebounceTimer = setTimeout(() => {
                    populateAudioSinks();
                }, 350);
            });
        }

        if (audioSinkSelect) {
            audioSinkSelect.addEventListener('change', () => {
                const val = audioSinkSelect.value;
                localStorage.setItem('lumen_master_audio_sink_id', val);
                ipcRenderer.send('stage-control', 'SET_AUDIO_SINK', { sinkId: val });
                if (typeof operatorAudioDeck !== 'undefined' && operatorAudioDeck && typeof operatorAudioDeck.setSinkId === 'function') {
                    operatorAudioDeck.setSinkId(val).catch(err => {
                        console.warn('Operator audio deck setSinkId failed:', err);
                        operatorAudioDeck.setSinkId('').catch(console.warn);
                    });
                }
                updateAudioIsolationWarning();
            });
        }

        if (cueAudioSinkSelect) {
            cueAudioSinkSelect.addEventListener('change', () => {
                const val = cueAudioSinkSelect.value;
                localStorage.setItem('lumen_cue_audio_sink_id', val);
                const pvwVid = pvwContainer ? pvwContainer.querySelector('video') : null;
                if (pvwVid && typeof pvwVid.setSinkId === 'function') {
                    pvwVid.setSinkId(val).catch(err => {
                        console.warn('Preview setSinkId failed, falling back to default:', err);
                        pvwVid.setSinkId('').catch(console.warn);
                    });
                }
                if (typeof operatorCuePlayer !== 'undefined' && operatorCuePlayer && typeof operatorCuePlayer.setSinkId === 'function') {
                    operatorCuePlayer.setSinkId(val).catch(err => {
                        console.warn('Operator cue player setSinkId failed:', err);
                        operatorCuePlayer.setSinkId('').catch(console.warn);
                    });
                }
                updateAudioIsolationWarning();
            });
        }


        // Audio Controls
        masterVolumeSlider.addEventListener('input', () => {
            const vol = Math.max(0, Math.min(1, parseFloat(masterVolumeSlider.value)));
            volumeValueText.innerText = Math.round(vol * 100) + '%';
            if (typeof operatorAudioDeck !== 'undefined' && operatorAudioDeck) {
                operatorAudioDeck.volume = isMasterMuted ? 0 : vol;
            }
            ipcRenderer.send('stage-control', 'SET_VOLUME', { volume: vol });
        });

        btnMuteMaster.addEventListener('click', () => {
            isMasterMuted = !isMasterMuted;
            btnMuteMaster.innerText = isMasterMuted ? 'UNMUTE' : 'Mute';
            btnMuteMaster.style.color = isMasterMuted ? '#fff' : 'var(--pgm-red)';
            btnMuteMaster.style.background = isMasterMuted ? 'var(--pgm-red)' : '';
            if (typeof operatorAudioDeck !== 'undefined' && operatorAudioDeck) {
                operatorAudioDeck.muted = isMasterMuted;
                operatorAudioDeck.volume = isMasterMuted ? 0 : parseFloat(masterVolumeSlider.value);
            }
            ipcRenderer.send('stage-control', 'SET_MUTE', { muted: isMasterMuted });
        });

        // Master VU Meter Simulation
        setInterval(() => {
            const hasAudioPlaying = (typeof operatorAudioDeck !== 'undefined' && operatorAudioDeck && !operatorAudioDeck.paused);
            if (isMasterMuted || (!pgmCue && !hasAudioPlaying)) {
                vuLeft.style.width = '0%';
                vuRight.style.width = '0%';
            } else {
                const vol = parseFloat(masterVolumeSlider.value);
                const rL = (30 + Math.random() * 65) * vol;
                const rR = (28 + Math.random() * 67) * vol;
                vuLeft.style.width = rL + '%';
                vuRight.style.width = rR + '%';
            }
        }, 120);

        // ==================== DEDICATED AUDIO / BGM DECK ENGINE ====================
        const operatorAudioDeck = document.getElementById('operatorAudioDeck');
        const operatorCuePlayer = document.getElementById('operatorCuePlayer');
        const audioWaveformCanvas = document.getElementById('audioWaveformCanvas');
        const waveformContainer = document.getElementById('waveformContainer');
        const audioDeckElapsed = document.getElementById('audioDeckElapsed');
        const audioDeckRemaining = document.getElementById('audioDeckRemaining');
        const audioDeckScrubber = document.getElementById('audioDeckScrubber');
        const audioDeckTrackTitle = document.getElementById('audioDeckTrackTitle');
        const audioDeckFmtBadge = document.getElementById('audioDeckFmtBadge');
        const audioDeckLiveBadge = document.getElementById('audioDeckLiveBadge');
        const btnAudioDeckPlayPause = document.getElementById('btnAudioDeckPlayPause');
        const btnAudioDeckStop = document.getElementById('btnAudioDeckStop');
        const btnAudioDeckLoop = document.getElementById('btnAudioDeckLoop');
        const btnAudioDeckFadeOut = document.getElementById('btnAudioDeckFadeOut');
        const btnCueAudioDeck = document.getElementById('btnCueAudioDeck');
        const btnAudioSyncLive = document.getElementById('btnAudioSyncLive');
        const btnLoadAudioDeckFile = document.getElementById('btnLoadAudioDeckFile');
        const audioDeckVuL = document.getElementById('audioDeckVuL');
        const audioDeckVuR = document.getElementById('audioDeckVuR');
        const audioDeckBlock = document.getElementById('audioDeckBlock');

        let audioDeckTrack = null;
        let isAudioDeckPlaying = false;
        let isAudioDeckLoop = false;
        let isAudioDeckCueOn = false;
        let isAudioSyncLive = true;
        let isAudioScrubbing = false;
        let audioDeckFadeAnimId = null;
        let currentWaveformPeaks = null;
        const audioWaveformCache = new Map();

        // 1. Web Audio API Waveform Peak Extraction & Caching
        async function generateWaveformPeaks(filePath, numBins = 140) {
            if (!filePath) return null;
            if (audioWaveformCache.has(filePath)) {
                return audioWaveformCache.get(filePath);
            }
            try {
                const fsMod = typeof require === 'function' ? require('fs') : null;
                if (fsMod && fsMod.existsSync(filePath)) {
                    const buffer = fsMod.readFileSync(filePath);
                    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                    if (AudioCtxClass) {
                        const ctx = new AudioCtxClass();
                        const arrayBuf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                        const audioBuffer = await ctx.decodeAudioData(arrayBuf);
                        ctx.close();

                        const channelData = audioBuffer.getChannelData(0);
                        const step = Math.floor(channelData.length / numBins);
                        const peaks = new Float32Array(numBins);

                        for (let i = 0; i < numBins; i++) {
                            const start = i * step;
                            let peak = 0;
                            for (let j = 0; j < step; j += 8) {
                                const val = Math.abs(channelData[start + j] || 0);
                                if (val > peak) peak = val;
                            }
                            peaks[i] = peak;
                        }

                        let maxPeak = 0;
                        for (let i = 0; i < numBins; i++) {
                            if (peaks[i] > maxPeak) maxPeak = peaks[i];
                        }
                        if (maxPeak > 0) {
                            for (let i = 0; i < numBins; i++) {
                                peaks[i] = Math.max(0.08, peaks[i] / maxPeak);
                            }
                        }
                        audioWaveformCache.set(filePath, peaks);
                        return peaks;
                    }
                }
            } catch (err) {
                console.warn('Web Audio peak extraction fallback:', err);
            }

            // Procedural broadcast waveform fallback
            const fallback = new Float32Array(numBins);
            for (let i = 0; i < numBins; i++) {
                fallback[i] = 0.15 + 0.7 * Math.abs(Math.sin(i * 0.14) * Math.cos(i * 0.05));
            }
            audioWaveformCache.set(filePath, fallback);
            return fallback;
        }

        // 2. Waveform Canvas Renderer
        function drawAudioWaveform(peaks, progressRatio = 0) {
            if (!audioWaveformCanvas) return;
            const ctx = audioWaveformCanvas.getContext('2d');
            const w = audioWaveformCanvas.width;
            const h = audioWaveformCanvas.height;
            ctx.clearRect(0, 0, w, h);

            if (!peaks || peaks.length === 0) {
                ctx.fillStyle = '#1e293b';
                ctx.fillRect(0, h / 2 - 1, w, 2);
                return;
            }

            const totalBars = peaks.length;
            const barWidth = 1.5;
            const gap = 0.5;
            const currentBarIdx = Math.floor(progressRatio * totalBars);

            for (let i = 0; i < totalBars; i++) {
                const x = i * (barWidth + gap);
                if (x >= w) break;

                const barHeight = Math.max(2, peaks[i] * (h - 4));
                const y = (h - barHeight) / 2;

                if (i <= currentBarIdx) {
                    ctx.fillStyle = '#00e5ff';
                } else {
                    ctx.fillStyle = '#1e293b';
                }
                ctx.fillRect(x, y, barWidth, barHeight);
            }

            // Playhead Cursor
            const cursorX = Math.min(w - 1, Math.max(0, progressRatio * w));
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(cursorX, 0, 1.5, h);
        }
        drawAudioWaveform(null, 0);

        // 3. Track Loading & Initialization
        async function loadTrackToAudioDeck(cueOrPath, autoPlay = false) {
            if (!cueOrPath || !operatorAudioDeck) return;
            let filePath = typeof cueOrPath === 'string' ? cueOrPath : (cueOrPath.path || '');
            let title = typeof cueOrPath === 'string' ? cueOrPath.split(/[\/\\]/).pop() : (cueOrPath.name || 'Audio Track');
            let ext = filePath.split('.').pop().toLowerCase();
            let format = ext.toUpperCase();

            audioDeckTrack = {
                id: (typeof cueOrPath === 'object' && cueOrPath.id) ? cueOrPath.id : ('audio_' + Date.now()),
                name: title,
                path: filePath,
                format: format,
                duration: (typeof cueOrPath === 'object' && cueOrPath.duration) ? cueOrPath.duration : 0
            };

            operatorAudioDeck.src = toMediaUrl(filePath);
            operatorAudioDeck.preload = 'auto';
            operatorAudioDeck.loop = isAudioDeckLoop;
            operatorAudioDeck.currentTime = 0;

            const sinkId = audioSinkSelect ? audioSinkSelect.value : '';
            if (typeof operatorAudioDeck.setSinkId === 'function') {
                operatorAudioDeck.setSinkId(sinkId).catch(() => operatorAudioDeck.setSinkId(''));
            }

            if (audioDeckTrackTitle) audioDeckTrackTitle.innerText = title;
            if (audioDeckFmtBadge) {
                audioDeckFmtBadge.innerText = format;
                audioDeckFmtBadge.className = `badge-fmt badge-fmt-${ext}`;
            }
            if (audioDeckElapsed) audioDeckElapsed.innerText = '00:00';
            if (audioDeckRemaining) audioDeckRemaining.innerText = '-00:00';
            if (audioDeckScrubber) audioDeckScrubber.value = 0;

            currentWaveformPeaks = await generateWaveformPeaks(filePath, 140);
            drawAudioWaveform(currentWaveformPeaks, 0);

            if (autoPlay) {
                playAudioDeck();
            }
        }

        // 4. Transport Controls Execution
        function playAudioDeck() {
            if (!operatorAudioDeck) return;
            if (!operatorAudioDeck.src || operatorAudioDeck.src === window.location.href) {
                if (audioDeckTrack && audioDeckTrack.path) {
                    loadTrackToAudioDeck(audioDeckTrack, true);
                } else if (pvwCue && pvwCue.type === 'audio') {
                    loadTrackToAudioDeck(pvwCue, true);
                }
                return;
            }

            const curVol = masterVolumeSlider ? parseFloat(masterVolumeSlider.value) : 1.0;
            operatorAudioDeck.volume = isMasterMuted ? 0 : curVol;
            operatorAudioDeck.muted = isMasterMuted;

            const sinkId = audioSinkSelect ? audioSinkSelect.value : '';
            if (typeof operatorAudioDeck.setSinkId === 'function') {
                operatorAudioDeck.setSinkId(sinkId).catch(() => operatorAudioDeck.setSinkId(''));
            }

            operatorAudioDeck.play().then(() => {
                isAudioDeckPlaying = true;
                if (audioDeckLiveBadge) {
                    audioDeckLiveBadge.className = 'audio-deck-badge live';
                    audioDeckLiveBadge.innerText = 'ON-AIR';
                }
                if (btnAudioDeckPlayPause) {
                    btnAudioDeckPlayPause.classList.add('playing');
                    btnAudioDeckPlayPause.innerHTML = '<svg class="icon-svg sm" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg><span class="btn-text">Pause</span>';
                }
                if (isAudioDeckCueOn && operatorCuePlayer) {
                    operatorCuePlayer.src = operatorAudioDeck.src;
                    operatorCuePlayer.currentTime = operatorAudioDeck.currentTime;
                    const cueSink = cueAudioSinkSelect ? cueAudioSinkSelect.value : '';
                    if (typeof operatorCuePlayer.setSinkId === 'function') {
                        operatorCuePlayer.setSinkId(cueSink).catch(() => operatorCuePlayer.setSinkId(''));
                    }
                    operatorCuePlayer.muted = false;
                    operatorCuePlayer.play().catch(console.warn);
                }
            }).catch(err => {
                console.warn('operatorAudioDeck play error:', err);
                isAudioDeckPlaying = false;
            });
        }

        function pauseAudioDeck() {
            if (!operatorAudioDeck) return;
            operatorAudioDeck.pause();
            isAudioDeckPlaying = false;
            if (audioDeckLiveBadge) {
                audioDeckLiveBadge.className = 'audio-deck-badge standby';
                audioDeckLiveBadge.innerText = 'STANDBY';
            }
            if (btnAudioDeckPlayPause) {
                btnAudioDeckPlayPause.classList.remove('playing');
                btnAudioDeckPlayPause.innerHTML = '<svg class="icon-svg sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span class="btn-text">Play</span>';
            }
            if (operatorCuePlayer) {
                operatorCuePlayer.pause();
            }
            if (audioDeckVuL) audioDeckVuL.style.height = '0%';
            if (audioDeckVuR) audioDeckVuR.style.height = '0%';
        }

        function stopAudioDeck() {
            if (!operatorAudioDeck) return;
            pauseAudioDeck();
            operatorAudioDeck.currentTime = 0;
            if (operatorCuePlayer) operatorCuePlayer.currentTime = 0;
            if (audioDeckElapsed) audioDeckElapsed.innerText = '00:00';
            const dur = operatorAudioDeck.duration || (audioDeckTrack ? audioDeckTrack.duration : 0);
            if (audioDeckRemaining) audioDeckRemaining.innerText = dur > 0 ? ('-' + formatTime(dur)) : '-00:00';
            if (audioDeckScrubber) audioDeckScrubber.value = 0;
            drawAudioWaveform(currentWaveformPeaks, 0);
        }

        function toggleAudioDeckPlayPause() {
            if (!operatorAudioDeck || operatorAudioDeck.paused) {
                playAudioDeck();
            } else {
                pauseAudioDeck();
            }
        }

        function toggleAudioDeckLoop() {
            isAudioDeckLoop = !isAudioDeckLoop;
            if (operatorAudioDeck) operatorAudioDeck.loop = isAudioDeckLoop;
            if (btnAudioDeckLoop) {
                const loopText = isAudioDeckLoop ? 'Loop: ON' : 'Loop: OFF';
                btnAudioDeckLoop.innerHTML = `<svg class="icon-svg sm" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg> <span class="btn-text">${loopText}</span>`;
                btnAudioDeckLoop.style.color = isAudioDeckLoop ? 'var(--accent-cyan)' : '';
                btnAudioDeckLoop.style.borderColor = isAudioDeckLoop ? 'rgba(0,229,255,0.4)' : '';
            }
        }

        function toggleAudioSyncLive() {
            isAudioSyncLive = !isAudioSyncLive;
            if (btnAudioSyncLive) {
                const syncText = isAudioSyncLive ? 'Sync: ON' : 'Sync: OFF';
                btnAudioSyncLive.innerHTML = `<svg class="icon-svg sm" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg> <span class="btn-text">${syncText}</span>`;
                btnAudioSyncLive.classList.toggle('active', isAudioSyncLive);
            }
        }

        function toggleAudioDeckCue() {
            isAudioDeckCueOn = !isAudioDeckCueOn;
            if (btnCueAudioDeck) {
                const cueText = isAudioDeckCueOn ? 'Cue: ON' : 'Cue: OFF';
                btnCueAudioDeck.innerHTML = `<svg class="icon-svg sm" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg> <span class="btn-text">${cueText}</span>`;
                btnCueAudioDeck.classList.toggle('active', isAudioDeckCueOn);
            }
            if (isAudioDeckCueOn && operatorCuePlayer && operatorAudioDeck) {
                operatorCuePlayer.src = operatorAudioDeck.src;
                operatorCuePlayer.currentTime = operatorAudioDeck.currentTime;
                const cueSink = cueAudioSinkSelect ? cueAudioSinkSelect.value : '';
                if (typeof operatorCuePlayer.setSinkId === 'function') {
                    operatorCuePlayer.setSinkId(cueSink).catch(() => operatorCuePlayer.setSinkId(''));
                }
                operatorCuePlayer.muted = false;
                if (!operatorAudioDeck.paused) {
                    operatorCuePlayer.play().catch(console.warn);
                }
            } else if (operatorCuePlayer) {
                operatorCuePlayer.pause();
                operatorCuePlayer.muted = true;
            }
        }

        function startAudioDeckFadeOut(durationMs = 2500) {
            if (!operatorAudioDeck || operatorAudioDeck.paused) return;
            if (audioDeckFadeAnimId) cancelAnimationFrame(audioDeckFadeAnimId);

            const startVol = operatorAudioDeck.volume;
            const startTime = performance.now();
            const nominalVol = masterVolumeSlider ? parseFloat(masterVolumeSlider.value) : 1.0;

            const stepFade = (now) => {
                const elapsed = now - startTime;
                const progress = Math.min(1.0, Math.max(0.0, elapsed / durationMs));
                const attenuation = Math.cos(progress * (Math.PI / 2));
                if (!isMasterMuted) {
                    operatorAudioDeck.volume = startVol * attenuation;
                }
                if (progress < 1.0) {
                    audioDeckFadeAnimId = requestAnimationFrame(stepFade);
                } else {
                    audioDeckFadeAnimId = null;
                    pauseAudioDeck();
                    operatorAudioDeck.volume = isMasterMuted ? 0 : nominalVol;
                }
            };
            audioDeckFadeAnimId = requestAnimationFrame(stepFade);
        }

        // 5. Timecode, Scrubber & Waveform Events
        if (operatorAudioDeck) {
            operatorAudioDeck.ontimeupdate = () => {
                const cur = operatorAudioDeck.currentTime || 0;
                const dur = Number.isFinite(operatorAudioDeck.duration) && operatorAudioDeck.duration > 0
                    ? operatorAudioDeck.duration
                    : (audioDeckTrack ? audioDeckTrack.duration : 0);

                if (audioDeckElapsed && typeof formatTime === 'function') {
                    audioDeckElapsed.innerText = formatTime(cur);
                }
                if (audioDeckRemaining && typeof formatTime === 'function' && dur > 0) {
                    audioDeckRemaining.innerText = '-' + formatTime(Math.max(0, dur - cur));
                }
                if (!isAudioScrubbing && audioDeckScrubber && dur > 0) {
                    audioDeckScrubber.value = (cur / dur) * 1000;
                }

                const ratio = dur > 0 ? (cur / dur) : 0;
                drawAudioWaveform(currentWaveformPeaks, ratio);

                // Stereo Mini VU Animation
                if (!operatorAudioDeck.paused && !isMasterMuted) {
                    const vol = masterVolumeSlider ? parseFloat(masterVolumeSlider.value) : 1.0;
                    const lvL = Math.min(100, (40 + Math.random() * 55) * vol);
                    const lvR = Math.min(100, (38 + Math.random() * 57) * vol);
                    if (audioDeckVuL) audioDeckVuL.style.height = `${lvL}%`;
                    if (audioDeckVuR) audioDeckVuR.style.height = `${lvR}%`;
                } else {
                    if (audioDeckVuL) audioDeckVuL.style.height = '0%';
                    if (audioDeckVuR) audioDeckVuR.style.height = '0%';
                }
            };

            operatorAudioDeck.onended = () => {
                if (isAudioDeckLoop) {
                    operatorAudioDeck.currentTime = 0;
                    operatorAudioDeck.play().catch(console.warn);
                } else {
                    pauseAudioDeck();
                    operatorAudioDeck.currentTime = 0;
                    if (audioDeckScrubber) audioDeckScrubber.value = 0;
                    drawAudioWaveform(currentWaveformPeaks, 0);
                }
            };
        }

        if (audioDeckScrubber) {
            audioDeckScrubber.onmousedown = () => { isAudioScrubbing = true; };
            audioDeckScrubber.ontouchstart = () => { isAudioScrubbing = true; };
            audioDeckScrubber.oninput = () => {
                isAudioScrubbing = true;
                const dur = operatorAudioDeck ? operatorAudioDeck.duration : (audioDeckTrack ? audioDeckTrack.duration : 0);
                if (dur > 0) {
                    const targetSec = (audioDeckScrubber.value / 1000) * dur;
                    if (audioDeckElapsed && typeof formatTime === 'function') audioDeckElapsed.innerText = formatTime(targetSec);
                    if (audioDeckRemaining && typeof formatTime === 'function') audioDeckRemaining.innerText = '-' + formatTime(Math.max(0, dur - targetSec));
                    drawAudioWaveform(currentWaveformPeaks, targetSec / dur);
                }
            };
            audioDeckScrubber.onchange = () => {
                isAudioScrubbing = false;
                const dur = operatorAudioDeck ? operatorAudioDeck.duration : (audioDeckTrack ? audioDeckTrack.duration : 0);
                if (dur > 0 && operatorAudioDeck) {
                    operatorAudioDeck.currentTime = (audioDeckScrubber.value / 1000) * dur;
                    if (operatorCuePlayer) operatorCuePlayer.currentTime = operatorAudioDeck.currentTime;
                }
            };
            audioDeckScrubber.onmouseup = () => { isAudioScrubbing = false; };
            audioDeckScrubber.ontouchend = () => { isAudioScrubbing = false; };
        }

        // Waveform Container Click-to-Seek
        if (waveformContainer) {
            waveformContainer.addEventListener('click', (e) => {
                const rect = waveformContainer.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                const dur = operatorAudioDeck ? operatorAudioDeck.duration : (audioDeckTrack ? audioDeckTrack.duration : 0);
                if (dur > 0 && operatorAudioDeck) {
                    operatorAudioDeck.currentTime = ratio * dur;
                    if (operatorCuePlayer) operatorCuePlayer.currentTime = operatorAudioDeck.currentTime;
                    drawAudioWaveform(currentWaveformPeaks, ratio);
                }
            });
        }

        // Wire Buttons
        if (btnAudioDeckPlayPause) btnAudioDeckPlayPause.addEventListener('click', toggleAudioDeckPlayPause);
        if (btnAudioDeckStop) btnAudioDeckStop.addEventListener('click', stopAudioDeck);
        if (btnAudioDeckLoop) btnAudioDeckLoop.addEventListener('click', toggleAudioDeckLoop);
        if (btnAudioDeckFadeOut) btnAudioDeckFadeOut.addEventListener('click', () => startAudioDeckFadeOut(2500));
        if (btnCueAudioDeck) btnCueAudioDeck.addEventListener('click', toggleAudioDeckCue);
        if (btnAudioSyncLive) btnAudioSyncLive.addEventListener('click', toggleAudioSyncLive);

        if (btnLoadAudioDeckFile) {
            btnLoadAudioDeckFile.addEventListener('click', async () => {
                const filePaths = await ipcRenderer.invoke('open-file-dialog', {
                    properties: ['openFile'],
                    filters: [
                        { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac'] },
                        { name: 'All Files', extensions: ['*'] }
                    ]
                });
                if (filePaths && filePaths.length > 0) {
                    loadTrackToAudioDeck(filePaths[0]);
                }
            });
        }

        // Drag & Drop onto Audio Deck Block
        if (audioDeckBlock) {
            audioDeckBlock.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                audioDeckBlock.style.borderColor = 'var(--accent-cyan)';
            });
            audioDeckBlock.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                audioDeckBlock.style.borderColor = '';
            });
            audioDeckBlock.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                audioDeckBlock.style.borderColor = '';
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const filePath = typeof resolveFilePath === 'function' ? resolveFilePath(e.dataTransfer.files[0]) : e.dataTransfer.files[0].path;
                    if (filePath) loadTrackToAudioDeck(filePath);
                }
            });
        }

