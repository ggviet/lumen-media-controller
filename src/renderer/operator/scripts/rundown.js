        // ==================== MEDIA INGESTION & CARD REORDERING ENGINE ====================
        const ALLOWED_VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv']);
        const ALLOWED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'svg', 'webp']);
        const ALLOWED_ALL_EXTS = new Set([...ALLOWED_VIDEO_EXTS, ...ALLOWED_IMAGE_EXTS]);
        const ALLOWED_AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac']);
        const ALLOWED_MEDIA_EXTS = new Set([...ALLOWED_ALL_EXTS, ...ALLOWED_AUDIO_EXTS]);
        const videoThumbnailCache = new Map();
        let draggedCueIndex = null;

        function validateMediaExtension(filePath) {
            if (!filePath || typeof filePath !== 'string') return false;
            const parts = filePath.split('.');
            if (parts.length < 2) return false;
            const ext = parts.pop().toLowerCase().trim();
            if (typeof ALLOWED_MEDIA_EXTS !== 'undefined') {
                return ALLOWED_MEDIA_EXTS.has(ext);
            }
            if (typeof ALLOWED_AUDIO_EXTS !== 'undefined' && ALLOWED_AUDIO_EXTS.has(ext)) {
                return true;
            }
            return ALLOWED_ALL_EXTS.has(ext);
        }

        function resolveFilePath(file) {
            if (!file) return '';
            try {
                const { webUtils } = require('electron');
                if (webUtils && typeof webUtils.getPathForFile === 'function') {
                    const p = webUtils.getPathForFile(file);
                    if (p && typeof p === 'string' && p.length > 0) return p;
                }
            } catch (_) {}
            return file.path || '';
        }

        function toMediaUrl(filePath) {
            if (!filePath || typeof filePath !== 'string') return '';
            if (filePath.startsWith('file://') || filePath.startsWith('data:') || filePath.startsWith('blob:') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
                return filePath;
            }
            try {
                const urlMod = typeof require === 'function' ? require('url') : null;
                if (urlMod && typeof urlMod.pathToFileURL === 'function') {
                    return urlMod.pathToFileURL(filePath).href;
                }
            } catch (_) {}
            let normalized = filePath.replace(/\\/g, '/');
            if (!normalized.startsWith('/')) normalized = '/' + normalized;
            return 'file://' + encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F');
        }

        function showOperatorToast(message, type = 'info', durationMs = 3500) {
            let toast = document.getElementById('lumenOperatorToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'lumenOperatorToast';
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.className = `operator-toast toast-${type} visible`;
            clearTimeout(toast._timer);
            toast._timer = setTimeout(() => {
                toast.classList.remove('visible');
            }, durationMs);
        }

        async function extractVideoMetadataAndThumbnail(filePath) {
            return new Promise((resolve) => {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.src = toMediaUrl(filePath);
                video.muted = true;

                let completed = false;
                const finalize = (metadata) => {
                    if (!completed) {
                        completed = true;
                        video.pause();
                        video.src = '';
                        video.load();
                        video.remove();
                        resolve(metadata);
                    }
                };

                video.onloadedmetadata = () => {
                    const duration = video.duration || 0;
                    const width = video.videoWidth || 0;
                    const height = video.videoHeight || 0;
                    const seekTime = Math.min(1.0, duration > 1 ? 0.5 : duration / 2);
                    video.currentTime = seekTime;
                };

                video.onseeked = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = 144;
                        canvas.height = 104;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(video, 0, 0, 144, 104);
                        const thumbData = canvas.toDataURL('image/jpeg', 0.75);
                        videoThumbnailCache.set(filePath, thumbData);
                        finalize({
                            duration: video.duration || 0,
                            width: video.videoWidth || 0,
                            height: video.videoHeight || 0,
                            thumbnailUrl: thumbData
                        });
                    } catch (e) {
                        finalize({
                            duration: video.duration || 0,
                            width: video.videoWidth || 0,
                            height: video.videoHeight || 0,
                            thumbnailUrl: null
                        });
                    }
                };

                video.onerror = () => finalize({ duration: 0, width: 0, height: 0, thumbnailUrl: null });
                setTimeout(() => finalize({ duration: 0, width: 0, height: 0, thumbnailUrl: null }), 2000);
            });
        }

        async function extractAudioMetadata(filePath) {
            return new Promise((resolve) => {
                const audio = document.createElement('audio');
                audio.preload = 'metadata';
                audio.src = toMediaUrl(filePath);
                let completed = false;

                const finalize = (duration) => {
                    if (!completed) {
                        completed = true;
                        audio.pause();
                        audio.removeAttribute('src');
                        audio.src = '';
                        try { audio.load(); } catch (_) {}
                        audio.remove();
                        resolve({ duration: duration || 0 });
                    }
                };

                audio.onloadedmetadata = () => {
                    const dur = audio.duration;
                    finalize(Number.isFinite(dur) && dur > 0 ? dur : 0);
                };

                audio.onerror = () => finalize(0);
                setTimeout(() => finalize(0), 1500);
            });
        }

        function updateUpDownButtons() {
            const btnUp = document.getElementById('btnMoveUp');
            const btnDown = document.getElementById('btnMoveDown');
            if (!btnUp || !btnDown) return;

            const canMoveUp = selectedIndex > 0;
            const canMoveDown = selectedIndex >= 0 && selectedIndex < rundown.length - 1;

            btnUp.disabled = !canMoveUp;
            btnUp.style.opacity = canMoveUp ? '1.0' : '0.4';
            btnUp.style.cursor = canMoveUp ? 'pointer' : 'not-allowed';

            btnDown.disabled = !canMoveDown;
            btnDown.style.opacity = canMoveDown ? '1.0' : '0.4';
            btnDown.style.cursor = canMoveDown ? 'pointer' : 'not-allowed';
        }

        function reorderRundown(fromIndex, toIndex) {
            if (fromIndex < 0 || fromIndex >= rundown.length) return false;
            if (toIndex < 0 || toIndex >= rundown.length) return false;
            if (fromIndex === toIndex) return false;

            const selectedCueId = (selectedIndex >= 0 && rundown[selectedIndex]) 
                ? rundown[selectedIndex].id 
                : null;

            const [moved] = rundown.splice(fromIndex, 1);
            rundown.splice(toIndex, 0, moved);

            if (selectedCueId) {
                selectedIndex = rundown.findIndex(c => c.id === selectedCueId);
            }

            renderRundown();
            saveRundown();
            return true;
        }

        // Rundown Rendering with HTML5 Drag-and-Drop Card Support & Search Filtering
        let cueSearchFilter = '';

        const cueSearchInput = document.getElementById('cueSearchInput');
        const btnClearSearch = document.getElementById('btnClearSearch');

        if (cueSearchInput) {
            cueSearchInput.addEventListener('input', (e) => {
                cueSearchFilter = (e.target.value || '').trim().toLowerCase();
                if (btnClearSearch) {
                    btnClearSearch.style.display = cueSearchFilter.length > 0 ? 'inline-block' : 'none';
                }
                renderRundown();
            });
        }

        if (btnClearSearch) {
            btnClearSearch.addEventListener('click', () => {
                if (cueSearchInput) {
                    cueSearchInput.value = '';
                    cueSearchFilter = '';
                    btnClearSearch.style.display = 'none';
                    renderRundown();
                }
            });
        }

        function renderRundown() {
            rundownList.innerHTML = '';
            cueCount.innerText = rundown.length;

            rundown.forEach((cue, idx) => {
                // If search query is present, filter out non-matching cues
                if (cueSearchFilter.length > 0) {
                    const matchName = cue.name && cue.name.toLowerCase().includes(cueSearchFilter);
                    const matchFmt = (cue.format || '').toLowerCase().includes(cueSearchFilter);
                    const matchType = (cue.type || '').toLowerCase().includes(cueSearchFilter);
                    if (!matchName && !matchFmt && !matchType) {
                        return;
                    }
                }

                const card = document.createElement('div');
                card.className = `cue-card ${idx === selectedIndex ? 'selected-pvw' : ''} ${pgmCue && pgmCue.id === cue.id ? 'active-pgm' : ''}`;
                card.draggable = true;
                card.dataset.index = idx;
                card.dataset.id = cue.id;

                // Format & duration tags
                const fmt = cue.format || (cue.path.split('.').pop().toUpperCase());
                const fmtLower = fmt.toLowerCase();
                const isAudioCue = cue.type === 'audio' || ALLOWED_AUDIO_EXTS.has(fmtLower);
                const durationTag = (cue.type === 'video' || isAudioCue)
                    ? (cue.duration ? formatTime(cue.duration) : '00:00')
                    : 'STILL';

                // Thumbnail presentation
                let thumbHtml = '';
                const cachedThumb = cue.type === 'video' ? (cue.thumbnailUrl || videoThumbnailCache.get(cue.path)) : null;
                if (cachedThumb) {
                    thumbHtml = `<img src="${cachedThumb}" alt="">`;
                } else if (cue.type === 'image' && cue.path) {
                    thumbHtml = `<img src="${toMediaUrl(cue.path)}" alt="">`;
                } else if (isAudioCue) {
                    thumbHtml = `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; background:linear-gradient(135deg, rgba(6,182,212,0.18), rgba(14,165,233,0.08)); border-radius:3px;"><span style="font-size:1.5rem; line-height:1;">🎵</span><span style="font-size:8px; font-weight:800; color:var(--accent-cyan); font-family:'JetBrains Mono', monospace; margin-top:2px;">AUDIO</span></div>`;
                } else {
                    thumbHtml = `<span style="font-size:1.4rem; opacity:0.8;">🎬</span>`;
                }

                // Resolution tag (if extracted)
                const resTag = (cue.width && cue.height)
                    ? `<span style="color:var(--text-dim); font-size:9px; font-family:'JetBrains Mono', Consolas, monospace; font-weight:700;">${cue.height >= 2160 ? '4K' : (cue.height >= 1080 ? '1080p' : cue.height + 'p')}</span>`
                    : '';

                card.innerHTML = `
                    <div class="cue-drag-grip" title="Kéo để sắp xếp lại">⋮⋮</div>
                    <div class="cue-thumb">
                        ${thumbHtml}
                        <div class="cue-badge-type">${cue.type.toUpperCase()}</div>
                        <div class="cue-thumb-duration">${durationTag}</div>
                    </div>
                    <div class="cue-meta">
                        <div class="cue-title-row">
                            <span class="badge-fmt badge-fmt-${fmtLower}">${fmt}</span>
                            <div class="cue-title" title="${cue.name}">${cue.name}</div>
                        </div>
                        <div class="cue-details">
                            <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                <span style="font-weight:700; font-family:'JetBrains Mono', Consolas, monospace; font-variant-numeric:tabular-nums lining-nums; color:var(--text-main); min-width:22px; flex-shrink:0;">#${idx + 1}</span>
                                ${resTag}
                            </div>
                            <span class="cue-behavior-tag">${cue.endBehavior}</span>
                        </div>
                    </div>
                `;

                // Card Click Selection
                card.addEventListener('click', () => {
                    selectCue(idx);
                });

                // HTML5 Drag and Drop Reordering Handlers
                card.addEventListener('dragstart', (e) => {
                    draggedCueIndex = idx;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('application/x-lumen-cue', String(idx));
                    e.dataTransfer.setData('text/plain', String(idx));
                    requestAnimationFrame(() => {
                        card.classList.add('dragging');
                    });
                });

                card.addEventListener('dragend', () => {
                    draggedCueIndex = null;
                    document.querySelectorAll('.cue-card').forEach(c => {
                        c.classList.remove('dragging', 'drag-insert-top', 'drag-insert-bottom');
                    });
                });

                card.addEventListener('dragover', (e) => {
                    if (draggedCueIndex === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';

                    const rect = card.getBoundingClientRect();
                    const relY = e.clientY - rect.top;
                    const isTopHalf = relY < rect.height / 2;

                    card.classList.toggle('drag-insert-top', isTopHalf);
                    card.classList.toggle('drag-insert-bottom', !isTopHalf);
                });

                card.addEventListener('dragleave', (e) => {
                    const rect = card.getBoundingClientRect();
                    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                        card.classList.remove('drag-insert-top', 'drag-insert-bottom');
                    }
                });

                card.addEventListener('drop', (e) => {
                    if (draggedCueIndex === null) return;
                    e.preventDefault();
                    e.stopPropagation();

                    const fromIdx = draggedCueIndex;
                    const rect = card.getBoundingClientRect();
                    const isTopHalf = (e.clientY - rect.top) < rect.height / 2;
                    let targetIdx = idx;

                    if (!isTopHalf) {
                        targetIdx = idx + 1;
                    }
                    if (fromIdx < targetIdx) {
                        targetIdx--;
                    }

                    card.classList.remove('drag-insert-top', 'drag-insert-bottom');
                    reorderRundown(fromIdx, targetIdx);
                });

                rundownList.appendChild(card);
            });

            updateUpDownButtons();
            saveRundown();
        }

        function selectCue(idx) {
            if (idx < 0 || idx >= rundown.length) return;
            selectedIndex = idx;
            pvwCue = rundown[idx];
            loadPvw(pvwCue);
            renderRundown();
        }

        // Cleanup previous media to prevent memory leak while preserving overlays
        function cleanupPvw() {
            const oldVideo = pvwContainer.querySelector('video');
            if (oldVideo) {
                oldVideo.onerror = null;
                oldVideo.onplay = null;
                oldVideo.onpause = null;
                oldVideo.ontimeupdate = null;
                oldVideo.onloadedmetadata = null;
                oldVideo.onended = null;
                oldVideo.pause();
                oldVideo.removeAttribute('src');
                oldVideo.src = '';
                oldVideo.load();
                oldVideo.remove();
            }
            const oldAudio = pvwContainer.querySelector('audio');
            if (oldAudio) {
                oldAudio.onerror = null;
                oldAudio.onplay = null;
                oldAudio.onpause = null;
                oldAudio.ontimeupdate = null;
                oldAudio.onloadedmetadata = null;
                oldAudio.onended = null;
                oldAudio.pause();
                oldAudio.removeAttribute('src');
                oldAudio.src = '';
                try { oldAudio.load(); } catch (_) {}
                oldAudio.remove();
            }
            // Remove previous images and audio wraps but preserve pvwTickerOverlay and hints
            pvwContainer.querySelectorAll('img, .pvw-audio-wrap').forEach(el => el.remove());
        }

        // Load into PREVIEW
        function loadPvw(cue) {
            cleanupPvw();
            pvwCueTitle.innerText = cue.name;
            pvwTypeTag.innerText = cue.type.toUpperCase();
            pvwEndBehaviorSelect.value = cue.endBehavior;
            document.getElementById('pvwFrame').classList.add('has-content');
            const pvwEmptyHint = document.getElementById('pvwEmptyHint');
            if (pvwEmptyHint) pvwEmptyHint.style.display = 'none';

            // Reset transport controls on new cue load
            btnPvwPlayPause.innerText = '▶ Play';
            pvwScrubber.value = 0;

            if (cue.type === 'video') {
                const video = document.createElement('video');
                video.src = toMediaUrl(cue.path);
                video.className = 'stage-media-element';
                video.style.objectFit = currentScaling;
                video.preload = 'auto';
                video.playsInline = true;

                const initialDur = Number.isFinite(cue.duration) && cue.duration > 0 ? cue.duration : 0;
                pvwTimeDisplay.innerText = `00:00 / ${formatTime(initialDur)}`;

                if (isCueAudioOn) {
                    const sinkVal = cueAudioSinkSelect ? cueAudioSinkSelect.value : '';
                    if (typeof video.setSinkId === 'function') {
                        video.setSinkId(sinkVal).catch(err => {
                            console.warn('Preview video setSinkId failed, fallback to default:', err);
                            video.setSinkId('').catch(console.warn);
                        });
                    }
                    video.muted = false;
                } else {
                    video.muted = true;
                }

                let isScrubbing = false;
                pvwScrubber.onmousedown = () => { isScrubbing = true; };
                pvwScrubber.ontouchstart = () => { isScrubbing = true; };
                pvwScrubber.oninput = () => {
                    isScrubbing = true;
                    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (cue.duration || 0);
                    if (dur > 0) {
                        const targetTime = (pvwScrubber.value / 100) * dur;
                        video.currentTime = targetTime;
                        pvwTimeDisplay.innerText = `${formatTime(targetTime)} / ${formatTime(dur)}`;
                    }
                };
                pvwScrubber.onchange = () => {
                    isScrubbing = false;
                };
                pvwScrubber.onmouseup = () => { isScrubbing = false; };
                pvwScrubber.ontouchend = () => { isScrubbing = false; };

                video.onloadedmetadata = () => {
                    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (cue.duration || 0);
                    pvwTimeDisplay.innerText = `${formatTime(video.currentTime || 0)} / ${formatTime(dur)}`;
                    if (dur > 0 && !cue.duration) {
                        cue.duration = dur;
                        cue.width = video.videoWidth || cue.width;
                        cue.height = video.videoHeight || cue.height;
                        renderRundown();
                    }
                };

                video.ontimeupdate = () => {
                    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (cue.duration || 0);
                    const cur = video.currentTime || 0;
                    pvwTimeDisplay.innerText = `${formatTime(cur)} / ${formatTime(dur)}`;
                    if (!isScrubbing && dur > 0) {
                        pvwScrubber.value = (cur / dur) * 100;
                    }
                };

                video.onplay = () => {
                    btnPvwPlayPause.innerText = '⏸ Pause';
                };

                video.onpause = () => {
                    btnPvwPlayPause.innerText = '▶ Play';
                };

                video.onended = () => {
                    btnPvwPlayPause.innerText = '▶ Play';
                    if (cue.endBehavior === 'LOOP') {
                        video.currentTime = 0;
                        video.play().catch(console.warn);
                    }
                };

                video.onerror = () => {
                    const err = video.error;
                    btnPvwPlayPause.innerText = '▶ Play';
                    // Ignore unload / empty src events during media replacement
                    if (!video.getAttribute('src') || video.src === window.location.href) return;

                    let reason = 'Định dạng tệp không được hỗ trợ hoặc codec bị thiếu';
                    if (err) {
                        if (err.code === 4) {
                            reason = 'Tệp không phải video hợp lệ hoặc codec không hỗ trợ (ví dụ: trang HTML tải về bị lưu thành đuôi .mp4)';
                        } else if (err.code === 3) {
                            reason = 'Lỗi giải mã luồng video (Decode Error)';
                        } else if (err.code === 2) {
                            reason = 'Lỗi đọc tệp hoặc đường dẫn không truy cập được (IO Error)';
                        } else if (err.code === 1) {
                            reason = 'Quá trình phát bị hủy (Aborted)';
                        }
                    }
                    console.error('Preview video error:', err, 'src:', video.src);
                    showOperatorToast(`⚠️ Không thể mở video: ${reason}`, 'error', 4500);
                };

                btnPvwPlayPause.onclick = () => {
                    if (video.paused) {
                        if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 0.1) {
                            video.currentTime = 0;
                        }
                        const playPromise = video.play();
                        if (playPromise !== undefined) {
                            playPromise.then(() => {
                                btnPvwPlayPause.innerText = '⏸ Pause';
                            }).catch(err => {
                                console.error('Preview video play failed:', err);
                                btnPvwPlayPause.innerText = '▶ Play';
                                showOperatorToast(`⚠️ Lỗi phát video Preview: ${err.message || err}`, 'warn');
                            });
                        }
                    } else {
                        video.pause();
                        btnPvwPlayPause.innerText = '▶ Play';
                    }
                };

                pvwContainer.appendChild(video);
            } else if (cue.type === 'audio') {
                const audio = document.createElement('audio');
                audio.src = toMediaUrl(cue.path);
                audio.preload = 'auto';
                audio.playsInline = true;

                const initialDur = Number.isFinite(cue.duration) && cue.duration > 0 ? cue.duration : 0;
                pvwTimeDisplay.innerText = `00:00 / ${formatTime(initialDur)}`;

                if (isCueAudioOn) {
                    const sinkVal = cueAudioSinkSelect ? cueAudioSinkSelect.value : '';
                    if (typeof audio.setSinkId === 'function') {
                        audio.setSinkId(sinkVal).catch(err => {
                            console.warn('Preview audio setSinkId failed, fallback to default:', err);
                            audio.setSinkId('').catch(console.warn);
                        });
                    }
                    audio.muted = false;
                } else {
                    audio.muted = true;
                }

                const audioWrap = document.createElement('div');
                audioWrap.className = 'stage-media-element pvw-audio-wrap';
                audioWrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; background:#0a0e17; width:100%; height:100%; text-align:center; padding:16px; user-select:none;';
                audioWrap.innerHTML = `
                    <div style="font-size:3.2rem; line-height:1; margin-bottom:10px; filter:drop-shadow(0 0 14px rgba(0,229,255,0.45));">🎵</div>
                    <div style="font-family:'JetBrains Mono', Consolas, monospace; font-size:13px; font-weight:700; color:var(--accent-cyan); max-width:90%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${cue.name}</div>
                    <div style="display:flex; gap:6px; align-items:center; margin-top:8px;">
                        <span class="badge-fmt badge-fmt-${(cue.format || 'mp3').toLowerCase()}">${cue.format || 'MP3'}</span>
                        <span style="font-size:10px; font-weight:700; color:var(--text-dim); letter-spacing:0.04em;">AUDIO PRE-FADER LISTEN</span>
                    </div>
                `;
                pvwContainer.appendChild(audioWrap);
                pvwContainer.appendChild(audio);

                let isScrubbing = false;
                pvwScrubber.onmousedown = () => { isScrubbing = true; };
                pvwScrubber.ontouchstart = () => { isScrubbing = true; };
                pvwScrubber.oninput = () => {
                    isScrubbing = true;
                    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (cue.duration || 0);
                    if (dur > 0) {
                        const targetTime = (pvwScrubber.value / 100) * dur;
                        audio.currentTime = targetTime;
                        pvwTimeDisplay.innerText = `${formatTime(targetTime)} / ${formatTime(dur)}`;
                    }
                };
                pvwScrubber.onchange = () => { isScrubbing = false; };
                pvwScrubber.onmouseup = () => { isScrubbing = false; };
                pvwScrubber.ontouchend = () => { isScrubbing = false; };

                audio.onloadedmetadata = () => {
                    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (cue.duration || 0);
                    pvwTimeDisplay.innerText = `${formatTime(audio.currentTime || 0)} / ${formatTime(dur)}`;
                    if (dur > 0 && !cue.duration) {
                        cue.duration = dur;
                        renderRundown();
                    }
                };

                audio.ontimeupdate = () => {
                    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (cue.duration || 0);
                    const cur = audio.currentTime || 0;
                    pvwTimeDisplay.innerText = `${formatTime(cur)} / ${formatTime(dur)}`;
                    if (!isScrubbing && dur > 0) {
                        pvwScrubber.value = (cur / dur) * 100;
                    }
                };

                audio.onplay = () => { btnPvwPlayPause.innerText = '⏸ Pause'; };
                audio.onpause = () => { btnPvwPlayPause.innerText = '▶ Play'; };
                audio.onended = () => {
                    btnPvwPlayPause.innerText = '▶ Play';
                    if (cue.endBehavior === 'LOOP') {
                        audio.currentTime = 0;
                        audio.play().catch(console.warn);
                    }
                };

                btnPvwPlayPause.onclick = () => {
                    if (audio.paused) {
                        if (Number.isFinite(audio.duration) && audio.duration > 0 && audio.currentTime >= audio.duration - 0.1) {
                            audio.currentTime = 0;
                        }
                        const playPromise = audio.play();
                        if (playPromise !== undefined) {
                            playPromise.then(() => {
                                btnPvwPlayPause.innerText = '⏸ Pause';
                            }).catch(err => {
                                console.error('Preview audio play failed:', err);
                                btnPvwPlayPause.innerText = '▶ Play';
                                showOperatorToast(`⚠️ Lỗi phát audio Preview: ${err.message || err}`, 'warn');
                            });
                        }
                    } else {
                        audio.pause();
                        btnPvwPlayPause.innerText = '▶ Play';
                    }
                };
            } else {
                const img = document.createElement('img');
                img.src = toMediaUrl(cue.path);
                img.style.objectFit = currentScaling;
                pvwContainer.appendChild(img);
                pvwTimeDisplay.innerText = 'STATIC IMAGE';
                pvwScrubber.value = 0;
                btnPvwPlayPause.innerText = '▶ Play';
                btnPvwPlayPause.onclick = null;
            }
        }

        // Cue Audio (Headphone Listen)
        btnCueAudio.addEventListener('click', () => {
            isCueAudioOn = !isCueAudioOn;
            btnCueAudio.innerText = `🎧 Cue: ${isCueAudioOn ? 'ON' : 'OFF'}`;
            btnCueAudio.style.color = isCueAudioOn ? 'var(--pvw-green)' : 'var(--text-main)';
            const vid = pvwContainer.querySelector('video');
            if (vid) {
                if (isCueAudioOn) {
                    const sinkVal = cueAudioSinkSelect ? cueAudioSinkSelect.value : '';
                    if (typeof vid.setSinkId === 'function') {
                        vid.setSinkId(sinkVal).catch(err => {
                            console.warn('Preview cue audio setSinkId failed, fallback to default:', err);
                            vid.setSinkId('').catch(console.warn);
                        });
                    }
                    vid.muted = false;
                } else {
                    vid.muted = true;
                }
            }
            const aud = pvwContainer.querySelector('audio');
            if (aud) {
                if (isCueAudioOn) {
                    const sinkVal = cueAudioSinkSelect ? cueAudioSinkSelect.value : '';
                    if (typeof aud.setSinkId === 'function') {
                        aud.setSinkId(sinkVal).catch(err => {
                            console.warn('Preview cue audio setSinkId failed, fallback to default:', err);
                            aud.setSinkId('').catch(console.warn);
                        });
                    }
                    aud.muted = false;
                } else {
                    aud.muted = true;
                }
            }
        });

        pvwEndBehaviorSelect.addEventListener('change', () => {
            if (pvwCue) {
                pvwCue.endBehavior = pvwEndBehaviorSelect.value;
                renderRundown();
            }
        });

        // Ingest File Paths (Validation & Background Extraction)
        async function ingestFilePaths(filePaths) {
            if (!Array.isArray(filePaths) || filePaths.length === 0) return;

            const validPaths = [];
            const rejectedPaths = [];

            for (const fp of filePaths) {
                if (validateMediaExtension(fp)) {
                    validPaths.push(fp);
                } else {
                    rejectedPaths.push(fp);
                }
            }

            if (rejectedPaths.length > 0) {
                const sample = rejectedPaths.map(p => p.split(/[\\/]/).pop()).slice(0, 2).join(', ');
                showOperatorToast(`⚠️ Bỏ qua ${rejectedPaths.length} file không hỗ trợ: ${sample}`, 'warn');
            }

            if (validPaths.length === 0) return;

            const newCues = [];
            for (const fp of validPaths) {
                const ext = fp.split('.').pop().toLowerCase().trim();
                const isVid = ALLOWED_VIDEO_EXTS.has(ext);
                const isAud = ALLOWED_AUDIO_EXTS.has(ext);
                const name = fp.split(/[\/\\]/).pop();
                const format = ext.toUpperCase();

                const cue = {
                    id: 'cue_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                    name: name,
                    path: fp,
                    type: isVid ? 'video' : (isAud ? 'audio' : 'image'),
                    format: format,
                    duration: 0,
                    width: 0,
                    height: 0,
                    endBehavior: 'HOLD_LAST_FRAME',
                    thumbnailUrl: isVid ? (videoThumbnailCache.get(fp) || null) : (isAud ? null : toMediaUrl(fp))
                };
                rundown.push(cue);
                newCues.push(cue);
            }

            renderRundown();
            if (selectedIndex === -1 && rundown.length > 0) {
                selectCue(0);
            }

            // Asynchronously resolve duration & thumbnails for new media
            for (const cue of newCues) {
                if (cue.type === 'video') {
                    extractVideoMetadataAndThumbnail(cue.path).then((meta) => {
                        cue.duration = meta.duration;
                        cue.width = meta.width;
                        cue.height = meta.height;
                        if (meta.thumbnailUrl) cue.thumbnailUrl = meta.thumbnailUrl;
                        renderRundown();
                    });
                } else if (cue.type === 'audio') {
                    extractAudioMetadata(cue.path).then((meta) => {
                        cue.duration = meta.duration;
                        renderRundown();
                    });
                }
            }
        }

        // Add Files via File Picker
        document.getElementById('btnAddFiles').addEventListener('click', async () => {
            const filePaths = await ipcRenderer.invoke('open-file-dialog');
            if (filePaths && filePaths.length > 0) {
                ingestFilePaths(filePaths);
            }
        });

        // Window Drag & Drop Listeners (External OS Files Only)
        function isExternalFileDrag(e) {
            if (!e.dataTransfer || !e.dataTransfer.types) return false;
            return Array.from(e.dataTransfer.types).includes('Files');
        }

        window.addEventListener('dragover', (e) => {
            if (isExternalFileDrag(e)) {
                e.preventDefault();
                e.stopPropagation();
                dropOverlay.classList.add('active');
            }
        });

        window.addEventListener('dragleave', (e) => {
            if (e.relatedTarget === null || e.clientX === 0 || e.clientY === 0) {
                dropOverlay.classList.remove('active');
            }
        });

        window.addEventListener('drop', (e) => {
            if (isExternalFileDrag(e)) {
                e.preventDefault();
                e.stopPropagation();
                dropOverlay.classList.remove('active');
                if (e.dataTransfer && e.dataTransfer.files) {
                    const paths = Array.from(e.dataTransfer.files).map(resolveFilePath).filter(Boolean);
                    ingestFilePaths(paths);
                }
            }
        });

        function resolveOperatorAssetDir() {
            try {
                const fs = require('fs');
                if (process.resourcesPath) {
                    const pkgAssets = path.join(process.resourcesPath, 'assets');
                    if (fs.existsSync(pkgAssets)) return pkgAssets;
                }
            } catch (_) {}
            return path.join(__dirname, '../../../assets');
        }

        // Load Sample Demo Set
        document.getElementById('btnLoadDemo').addEventListener('click', () => {
            const basePath = resolveOperatorAssetDir();
            rundown = [
                {
                    id: 'cue_demo_1',
                    name: '1. Tech Summit 2026 - Main Key Visual',
                    path: path.join(basePath, 'sample_keyvisual.svg'),
                    type: 'image',
                    format: 'SVG',
                    duration: 0,
                    endBehavior: 'HOLD_LAST_FRAME'
                },
                {
                    id: 'cue_demo_2',
                    name: '2. Opening Countdown Show (Live 720p Video)',
                    path: path.join(basePath, 'sample_countdown_video.webm'),
                    type: 'video',
                    format: 'WEBM',
                    duration: 5,
                    width: 1280,
                    height: 720,
                    endBehavior: 'HOLD_LAST_FRAME'
                },
                {
                    id: 'cue_demo_3',
                    name: '3. Opening Countdown Graphic (30s Standby)',
                    path: path.join(basePath, 'sample_countdown.svg'),
                    type: 'image',
                    format: 'SVG',
                    duration: 0,
                    endBehavior: 'HOLD_LAST_FRAME'
                },
                {
                    id: 'cue_demo_4',
                    name: '4. LUMEN Brand Showcase (Intro Graphic)',
                    path: path.join(basePath, 'logo.svg'),
                    type: 'image',
                    format: 'SVG',
                    duration: 0,
                    endBehavior: 'LOOP'
                }
            ];
            renderRundown();
            selectCue(0);
        });

        // ==================== UNDO STACK FOR RUNDOWN SAFETY ====================
        const rundownUndoStack = [];
        const MAX_UNDO_DEPTH = 20;

        function pushRundownHistory(actionDescription = 'Thay đổi kịch bản') {
            try {
                const snapshot = JSON.stringify({
                    rundown: rundown.map(c => ({ ...c })),
                    selectedIndex: selectedIndex
                });
                rundownUndoStack.push({ snapshot, description: actionDescription });
                if (rundownUndoStack.length > MAX_UNDO_DEPTH) {
                    rundownUndoStack.shift();
                }
            } catch (err) {
                console.warn('Could not record undo state:', err);
            }
        }

        function undoLastRundownAction() {
            if (rundownUndoStack.length === 0) {
                showOperatorToast('ℹ️ Không có thao tác nào để hoàn tác (Undo stack rỗng)', 'info', 2000);
                return;
            }
            const lastState = rundownUndoStack.pop();
            try {
                const data = JSON.parse(lastState.snapshot);
                rundown = data.rundown;
                selectedIndex = data.selectedIndex;
                renderRundown();
                if (selectedIndex >= 0 && selectedIndex < rundown.length) {
                    selectCue(selectedIndex);
                } else if (rundown.length > 0) {
                    selectCue(0);
                } else {
                    pvwCue = null;
                    cleanupPvw();
                    pvwCueTitle.innerText = 'NO CUE SELECTED';
                    pvwTypeTag.innerText = 'STANDBY';
                    document.getElementById('pvwFrame').classList.remove('has-content');
                }
                showOperatorToast(`↩️ Đã hoàn tác: ${lastState.description} (Ctrl+Z)`, 'info', 2500);
            } catch (err) {
                console.error('Failed to restore undo state:', err);
            }
        }

        // Global hotkey Ctrl+Z for undoing rundown modifications
        window.addEventListener('keydown', (e) => {
            const tagName = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
            const isText = ['INPUT', 'TEXTAREA'].includes(tagName);
            if (!isText && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                e.preventDefault();
                undoLastRundownAction();
            }
        });

        // Delete Cue with Undo Recording
        function deleteSelectedCue() {
            if (selectedIndex >= 0 && selectedIndex < rundown.length) {
                const deletedName = rundown[selectedIndex].name;
                pushRundownHistory(`Xóa Cue "${deletedName}"`);
                rundown.splice(selectedIndex, 1);
                if (selectedIndex >= rundown.length) selectedIndex = rundown.length - 1;
                renderRundown();
                if (selectedIndex >= 0) selectCue(selectedIndex);
                else {
                    pvwCue = null;
                    cleanupPvw();
                    pvwCueTitle.innerText = 'NO CUE SELECTED';
                    pvwTypeTag.innerText = 'STANDBY';
                    document.getElementById('pvwFrame').classList.remove('has-content');
                }
                showOperatorToast(`🗑️ Đã xóa cue. Bấm Ctrl+Z để hoàn tác`, 'info', 3000);
            }
        }
        document.getElementById('btnDeleteCue').addEventListener('click', deleteSelectedCue);

        // Clear All with Confirmation & Undo Recording
        document.getElementById('btnClearRundown').addEventListener('click', () => {
            if (rundown.length === 0) return;
            if (confirm(`Bạn có chắc muốn xóa sạch toàn bộ kịch bản Rundown (${rundown.length} mục)?`)) {
                pushRundownHistory(`Xóa toàn bộ ${rundown.length} cues`);
                rundown = [];
                selectedIndex = -1;
                pvwCue = null;
                cleanupPvw();
                pvwCueTitle.innerText = 'NO CUE SELECTED';
                pvwTypeTag.innerText = 'STANDBY';
                document.getElementById('pvwFrame').classList.remove('has-content');
                renderRundown();
                showOperatorToast(`🗑️ Đã xóa sạch rundown. Bấm Ctrl+Z để khôi phục!`, 'warn', 4000);
            }
        });

        // Move Up / Down Buttons
        document.getElementById('btnMoveUp').addEventListener('click', () => {
            if (selectedIndex > 0) {
                reorderRundown(selectedIndex, selectedIndex - 1);
            }
        });

        document.getElementById('btnMoveDown').addEventListener('click', () => {
            if (selectedIndex >= 0 && selectedIndex < rundown.length - 1) {
                reorderRundown(selectedIndex, selectedIndex + 1);
            }
        });

        // Storage Save / Load
        function saveRundown() {
            const cleanRundown = rundown.map(c => ({
                id: c.id,
                name: c.name,
                path: c.path,
                type: c.type,
                format: c.format,
                duration: c.duration,
                width: c.width,
                height: c.height,
                endBehavior: c.endBehavior
            }));
            try {
                localStorage.setItem('lumen_rundown', JSON.stringify(cleanRundown));
            } catch (e) {
                console.warn('LocalStorage save failed:', e);
            }
        }

        function loadRundown() {
            const raw = localStorage.getItem('lumen_rundown');
            if (raw) {
                try {
                    rundown = JSON.parse(raw);
                    renderRundown();
                    if (rundown.length > 0) selectCue(0);
                    // Asynchronously resolve video metadata / thumbnails
                    rundown.forEach(cue => {
                        if (cue.type === 'video') {
                            extractVideoMetadataAndThumbnail(cue.path).then(meta => {
                                cue.duration = meta.duration || cue.duration;
                                cue.width = meta.width || cue.width;
                                cue.height = meta.height || cue.height;
                                if (meta.thumbnailUrl) cue.thumbnailUrl = meta.thumbnailUrl;
                                renderRundown();
                            });
                        } else if (cue.type === 'audio') {
                            extractAudioMetadata(cue.path).then(meta => {
                                cue.duration = meta.duration || cue.duration;
                                renderRundown();
                            });
                        }
                    });
                } catch (e) {
                    console.error(e);
                }
            } else {
                document.getElementById('btnLoadDemo').click();
            }
        }
        loadRundown();

