const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false } });
  await win.loadURL('about:blank');

  const videoBase64 = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      };

      recorder.start();
      let frame = 0;
      const totalFrames = 150; // 5 seconds at 30fps

      const timer = setInterval(() => {
        const sec = (frame / 30).toFixed(1);
        const rem = Math.ceil((totalFrames - frame) / 30);

        // Broadcast Background
        const grad = ctx.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, '#04060a');
        grad.addColorStop(1, '#0b1626');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);

        // Tech grid
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
        ctx.lineWidth = 1;
        for (let x = 0; x < 1280; x += 64) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 720); ctx.stroke();
        }
        for (let y = 0; y < 720; y += 64) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1280, y); ctx.stroke();
        }

        // Animated neon countdown circle
        const progress = frame / totalFrames;
        ctx.beginPath();
        ctx.arc(640, 320, 130, -Math.PI / 2, -Math.PI / 2 + (progress * 2 * Math.PI));
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 8;
        ctx.stroke();

        // Big countdown number
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 80px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(rem + 's', 640, 320);

        // Title and subtitles
        ctx.font = 'bold 28px sans-serif';
        ctx.fillStyle = '#00e5ff';
        ctx.fillText('LUMEN PRO - EVENT OPENING DEMO', 640, 500);
        ctx.font = '16px monospace';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('BROADCAST PLAYBACK VERIFIED • ' + sec + 's / 5.0s', 640, 540);

        frame++;
        if (frame >= totalFrames) {
          clearInterval(timer);
          recorder.stop();
        }
      }, 33);
    })
  `);

  const targetPath = path.join(__dirname, '../assets/sample_countdown_video.webm');
  fs.writeFileSync(targetPath, Buffer.from(videoBase64, 'base64'));
  console.log('Sample video created successfully:', targetPath, 'size:', fs.statSync(targetPath).size);
  app.quit();
});
