        // ==================== MEDIA INGESTION & CARD REORDERING ENGINE ====================
        const ALLOWED_VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv']);
        const ALLOWED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'svg', 'webp']);
        const ALLOWED_ALL_EXTS = new Set([...ALLOWED_VIDEO_EXTS, ...ALLOWED_IMAGE_EXTS]);
        const videoThumbnailCache = new Map();
        let draggedCueIndex = null;

        function validateMediaExtension(filePath) {
            if (!filePath || typeof filePath !== 'string') return false;
            const parts = filePath.split('.');
            if (parts.length < 2) return false;
            const ext = parts.pop().toLowerCase().trim();
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

        // Rundown Rendering with HTML5 Drag-and-Drop Card Support
        function renderRundown() {
            rundownList.innerHTML = '';
            cueCount.innerText = rundown.length;

            rundown.forEach((cue, idx) => {
                const card = document.createElement('div');
                card.className = `cue-card ${idx === selectedIndex ? 'selected-pvw' : ''} ${pgmCue && pgmCue.id === cue.id ? 'active-pgm' : ''}`;
                card.draggable = true;
                card.dataset.index = idx;
                card.dataset.id = cue.id;

                // Format & duration tags
                const fmt = cue.format || (cue.path.split('.').pop().toUpperCase());
                const fmtLower = fmt.toLowerCase();
                const durationTag = cue.type === 'video'
                    ? (cue.duration ? formatTime(cue.duration) : '00:00')
                    : 'STILL';

                // Thumbnail presentation
                let thumbHtml = '';
                const cachedThumb = cue.type === 'video' ? (cue.thumbnailUrl || videoThumbnailCache.get(cue.path)) : null;
                if (cachedThumb) {
                    thumbHtml = `<img src="${cachedThumb}" alt="">`;
                } else if (cue.type === 'image' && cue.path) {
                    thumbHtml = `<img src="${toMediaUrl(cue.path)}" alt="">`;
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

        // Cleanup previous media to prevent memory leak
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
            pvwContainer.innerHTML = '';
        }

        // Load into PREVIEW
        function loadPvw(cue) {
            cleanupPvw();
            pvwCueTitle.innerText = cue.name;
            pvwTypeTag.innerText = cue.type.toUpperCase();
            pvwEndBehaviorSelect.value = cue.endBehavior;
            document.getElementById('pvwFrame').classList.add('has-content');

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
                const name = fp.split(/[\/\\]/).pop();
                const format = ext.toUpperCase();

                const cue = {
                    id: 'cue_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                    name: name,
                    path: fp,
                    type: isVid ? 'video' : 'image',
                    format: format,
                    duration: 0,
                    width: 0,
                    height: 0,
                    endBehavior: 'HOLD_LAST_FRAME',
                    thumbnailUrl: isVid ? (videoThumbnailCache.get(fp) || null) : toMediaUrl(fp)
                };
                rundown.push(cue);
                newCues.push(cue);
            }

            renderRundown();
            if (selectedIndex === -1 && rundown.length > 0) {
                selectCue(0);
            }

            // Asynchronously resolve duration & thumbnails for new videos
            for (const cue of newCues) {
                if (cue.type === 'video') {
                    extractVideoMetadataAndThumbnail(cue.path).then((meta) => {
                        cue.duration = meta.duration;
                        cue.width = meta.width;
                        cue.height = meta.height;
                        if (meta.thumbnailUrl) cue.thumbnailUrl = meta.thumbnailUrl;
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

        // Delete Cue
        function deleteSelectedCue() {
            if (selectedIndex >= 0 && selectedIndex < rundown.length) {
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
            }
        }
        document.getElementById('btnDeleteCue').addEventListener('click', deleteSelectedCue);

        // Clear All
        document.getElementById('btnClearRundown').addEventListener('click', () => {
            if (confirm('Bạn có chắc muốn xóa sạch toàn bộ kịch bản Rundown?')) {
                rundown = [];
                selectedIndex = -1;
                pvwCue = null;
                cleanupPvw();
                pvwCueTitle.innerText = 'NO CUE SELECTED';
                pvwTypeTag.innerText = 'STANDBY';
                document.getElementById('pvwFrame').classList.remove('has-content');
                renderRundown();
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

