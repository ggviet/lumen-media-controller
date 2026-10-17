        // ==================== WEB MIDI HARDWARE CONTROLLER INTEGRATION ====================
        function parseMIDIMessage(rawData) {
            if (!rawData || typeof rawData.length !== 'number' || rawData.length < 2) {
                return { handled: false, reason: 'invalid_packet' };
            }
            const statusByte = Number.isFinite(rawData[0]) ? rawData[0] : 0;
            const command = statusByte & 0xf0;
            const data1 = Number.isFinite(rawData[1]) ? rawData[1] : 0;
            const rawData2 = rawData.length > 2 ? rawData[2] : 0;
            const data2 = Number.isFinite(rawData2) ? rawData2 : 0;

            // Note-On (0x90)
            if (command === 0x90) {
                if (data2 === 0) {
                    // Velocity 0 is standard MIDI Note-Off
                    return { handled: false, reason: 'velocity_zero_note_off' };
                }
                if (data1 === 36 || data1 === 60) {
                    triggerGoLive();
                    return { handled: true, action: 'GO_LIVE', note: data1 };
                }
                if (data1 === 37 || data1 === 61) {
                    btnBlackout.click();
                    return { handled: true, action: 'BLACKOUT', note: data1 };
                }
                if (data1 === 38 || data1 === 62) {
                    btnFreeze.click();
                    return { handled: true, action: 'FREEZE', note: data1 };
                }
                if (data1 === 39 || data1 === 63) {
                    btnSafeLogo.click();
                    return { handled: true, action: 'SAFE_LOGO', note: data1 };
                }
                if (data1 === 40 || data1 === 64) {
                    btnFTB.click();
                    return { handled: true, action: 'FTB', note: data1 };
                }
                if (data1 === 41 || data1 === 65) {
                    btnMuteMaster.click();
                    return { handled: true, action: 'MUTE', note: data1 };
                }
            }

            // Control Change (0xB0) — CC 7 (Master Volume) or CC 1 (Modulation Fader)
            if (command === 0xb0 && (data1 === 7 || data1 === 1)) {
                const clampedVal = Math.max(0, Math.min(127, data2));
                const normalizedVolume = Math.round((clampedVal / 127) * 1000) / 1000;
                if (masterVolumeSlider) {
                    masterVolumeSlider.value = String(normalizedVolume);
                }
                if (volumeValueText) {
                    volumeValueText.innerText = Math.round(normalizedVolume * 100) + '%';
                }
                ipcRenderer.send('stage-control', 'SET_VOLUME', { volume: normalizedVolume });
                return { handled: true, action: 'SET_VOLUME', cc: data1, normalizedVolume };
            }

            return { handled: false, reason: 'unmapped_midi' };
        }

        async function initWebMIDI() {
            if (!navigator || typeof navigator.requestMIDIAccess !== 'function') return;
            try {
                const midiAccess = await navigator.requestMIDIAccess({ sysex: false });
                const bindInputs = () => {
                    for (const input of midiAccess.inputs.values()) {
                        input.onmidimessage = (event) => {
                            try {
                                parseMIDIMessage(event.data);
                            } catch (err) {
                                console.warn('MIDI message handler error:', err);
                            }
                        };
                    }
                };
                bindInputs();
                midiAccess.onstatechange = () => bindInputs();
            } catch (err) {
                console.warn('Web MIDI initialization skipped/unavailable:', err);
            }
        }
        initWebMIDI();

