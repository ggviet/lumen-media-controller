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
                updateAudioIsolationWarning();
            });
        }


        // Audio Controls
        masterVolumeSlider.addEventListener('input', () => {
            const vol = Math.max(0, Math.min(1, parseFloat(masterVolumeSlider.value)));
            volumeValueText.innerText = Math.round(vol * 100) + '%';
            ipcRenderer.send('stage-control', 'SET_VOLUME', { volume: vol });
        });

        btnMuteMaster.addEventListener('click', () => {
            isMasterMuted = !isMasterMuted;
            btnMuteMaster.innerText = isMasterMuted ? 'UNMUTE' : 'Mute';
            btnMuteMaster.style.color = isMasterMuted ? '#fff' : 'var(--pgm-red)';
            btnMuteMaster.style.background = isMasterMuted ? 'var(--pgm-red)' : '';
            ipcRenderer.send('stage-control', 'SET_MUTE', { muted: isMasterMuted });
        });

        // VU Meter Simulation
        setInterval(() => {
            if (isMasterMuted || !pgmCue) {
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

