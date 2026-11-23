(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Starfields: sprinkle twinkling dots into every .stars layer
  document.querySelectorAll('.stars').forEach((layer) => {
    const count = Number(layer.dataset.count) || 30;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const s = document.createElement('i');
      const big = Math.random() < 0.08;
      const size = big ? 5 + Math.random() * 5 : 1 + Math.random() * 2.2;
      s.style.width = s.style.height = `${size}px`;
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${Math.random() * 100}%`;
      s.style.setProperty('--o', (0.35 + Math.random() * 0.6).toFixed(2));
      s.style.setProperty('--dur', `${3 + Math.random() * 5}s`);
      s.style.setProperty('--delay', `${-Math.random() * 6}s`);
      if (big) s.className = 'blur';
      frag.appendChild(s);
    }
    layer.appendChild(frag);
  });

  // Mobile nav
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav-toggle');
  const setOpen = (open) => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle.focus(); }
  });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) setOpen(false); });

  // Scroll reveal with a small stagger between siblings
  const items = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
  } else {
    items.forEach((el) => {
      const siblings = [...el.parentElement.children].filter((c) => c.classList.contains('reveal'));
      el.style.setProperty('--rd', `${Math.min(siblings.indexOf(el), 6) * 0.07}s`);
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach((el) => io.observe(el));
  }

  // Hero editor mock: the playhead sweeps the timeline; the top tabs follow it and are clickable
  const timeline = document.querySelector('.timeline');
  const playhead = timeline && timeline.querySelector('.playhead');
  if (playhead) {
    const tc = playhead.querySelector('.tc');
    const kpiTc = document.querySelector('.kpi-tc');
    const label = tc.nextSibling;
    const tracks = timeline.querySelector('.tracks');
    const status = document.querySelector('.mock-status');
    const ratioPill = document.querySelector('.pill-ratio');
    const tabs = [...document.querySelectorAll('.mock [data-mode]')];
    const ratioBtns = [...timeline.querySelectorAll('[data-ratio]')];

    // Each step: where the playhead jumps to, which track lights up, and the "Now editing" text
    const MODES = {
      timeline: { at: 0,    track: null, tip: ' · Hook lands',          status: 'raw clips → real magic' },
      broll:    { at: 0.22, track: 'ai', tip: ' · AI B-roll drops in',  status: 'AI B-roll, shot by shot' },
      voice:    { at: 0.5,  track: 'a',  tip: ' · Voiceover kicks in',  status: 'a voiceover timed to the cut' },
      captions: { at: 0.78, track: 't',  tip: ' · Captions pop',        status: 'captions that pop on the beat' },
      export:   { at: 1,    track: null, tip: ' · Exporting',           status: 'every cut, ready to post' },
    };
    const SWEEP = ['timeline', 'broll', 'voice', 'captions'];
    const LENGTH = 25;        // seconds shown on the ruler
    const CYCLE = 12000;      // ms per sweep
    const EXPORT_MS = 2200;   // export progress duration
    const READY_MS = 1600;    // how long "Export ready" stays
    let mode = '', ratio = '9:16';
    let exportFrom = -1, exportT0 = 0; // -1 = not exporting
    let video = null; // the project playing from the queue: { player, p, duration, name }

    const fmt = (s) => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

    const setMode = (m) => {
      if (m === mode) return;
      mode = m;
      tabs.forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      const focus = MODES[m].track;
      tracks.classList.toggle('has-focus', !!focus);
      tracks.querySelectorAll('.track').forEach((t) => t.classList.toggle('is-focus', t.dataset.track === focus));
      if (status && !video) status.textContent = MODES[m].status;
    };
    const stepAt = (p) => SWEEP.filter((k) => p >= MODES[k].at).pop();

    // Performance: measure the timeline once (and again only on resize), and only touch the
    // page when something actually changed, so the hero doesn't re-layout every frame.
    let geo = null, lastX = -1, lastTc = '', lastTip = '', lastFlip = null, lastP = -1;
    const pfNow = document.querySelector('.pf-now');
    const pfDur = document.querySelector('.pf-dur');
    // Editor-style timecode HH:MM:SS:FF at 30 fps
    const fmtTC = (s) => {
      s = Math.max(0, s);
      const whole = Math.floor(s), ff = Math.floor((s - whole) * 30);
      return `00:${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
    };
    let lastTC = '';
    const measure = () => {
      const lane = timeline.querySelector('.clips');
      const tl = timeline.getBoundingClientRect();
      const lr = lane.getBoundingClientRect();
      const ruler = timeline.querySelector('.ruler');
      geo = { start: lr.left - tl.left, width: lr.width };
      // the playhead's dot sits on the ruler
      if (ruler) playhead.style.top = `${Math.round(ruler.getBoundingClientRect().top - tl.top + 6)}px`;
    };
    if ('ResizeObserver' in window) new ResizeObserver(() => { geo = null; lastP = -1; }).observe(timeline);
    else window.addEventListener('resize', () => { geo = null; lastP = -1; });

    const setTip = (text) => { if (text !== lastTip) { lastTip = text; label.textContent = text; } };
    const place = (p) => {
      if (!geo) measure();
      const x = Math.round((geo.start - 1 + p * geo.width) * 2) / 2;
      if (x !== lastX) { lastX = x; playhead.style.transform = `translateX(${x}px)`; }
      // While a project plays, show its real time; otherwise the 25-second demo ruler
      const secs = video && video.duration ? p * video.duration : Math.min(LENGTH, p * LENGTH);
      const t = fmt(secs);
      if (t !== lastTc) { lastTc = t; tc.textContent = t; if (kpiTc) kpiTc.textContent = t; }
      const T = fmtTC(secs);
      if (pfNow && T !== lastTC) { lastTC = T; pfNow.textContent = T; }
      const flip = p > 0.62;
      if (flip !== lastFlip) { lastFlip = flip; playhead.classList.toggle('flip', flip); }
    };
    const render = (p) => {
      if (p === lastP) return; // nothing moved
      lastP = p;
      place(p);
      setTip(MODES[stepAt(p)].tip);
      setMode(stepAt(p));
    };
    // Export: run the playhead to the end with a % counter, then show "ready"
    const renderExport = (elapsed) => {
      const k = Math.min(1, elapsed / EXPORT_MS);
      place(exportFrom + (1 - exportFrom) * k);
      lastP = -1; // make the next normal render redraw
      setTip(k < 1 ? ` · Exporting ${ratio} · ${Math.round(k * 100)}%` : ` · ${ratio} export ready ✓`);
      return elapsed >= EXPORT_MS + READY_MS; // true when finished
    };

    let p = 0, t0 = performance.now(), raf = 0, visible = false;
    const seek = (to) => { p = to; t0 = performance.now() - to * CYCLE; };

    const startExport = () => {
      exportFrom = Math.min(p, 0.95); exportT0 = performance.now();
      setMode('export');
      playhead.classList.add('exporting');
      if (reduceMotion) { exportFrom = 1; renderExport(EXPORT_MS); }
    };
    const endExport = () => { exportFrom = -1; playhead.classList.remove('exporting'); seek(0); };

    // Jump the playhead (and the playing video, if any) to a point 0–1 on the timeline
    const jumpTo = (to) => {
      if (exportFrom >= 0) endExport();
      if (video) {
        video.p = to;
        if (video.player && video.duration) video.player.setCurrentTime(Math.min(to, 0.999) * video.duration).catch(() => {});
      } else {
        seek(to);
      }
      p = to;
      render(p);
    };

    tabs.forEach((b) => b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if (m === 'export') { startExport(); return; }
      jumpTo(MODES[m].at);
    }));

    // Click anywhere on the tracks to scrub
    tracks.addEventListener('click', (e) => {
      const lane = tracks.querySelector('.clips').getBoundingClientRect();
      jumpTo(Math.min(1, Math.max(0, (e.clientX - lane.left) / lane.width)));
    });

    // ---- Project queue: pick a portfolio video, play it, and drive the timeline from it ----
    const mockEl = document.querySelector('.mock');
    const playerBox = document.querySelector('.preview');
    const frameBox = playerBox && playerBox.querySelector('.player-frame');
    const playerTitle = playerBox && playerBox.querySelector('.player-title');
    const closeBtn = playerBox && playerBox.querySelector('.player-close');
    const emptyHTML = frameBox ? frameBox.innerHTML : '';
    const titleDefault = playerTitle ? playerTitle.textContent : '';
    const qBtns = [...document.querySelectorAll('.queue .q[data-vimeo]')];
    const seqTitle = document.querySelector('.seq-title');
    const seqDefault = seqTitle ? seqTitle.textContent : '';
    const rulerSpans = [...timeline.querySelectorAll('.ruler span')];
    const rulerDefault = rulerSpans.map((s) => s.textContent);
    const setRuler = (dur) => rulerSpans.forEach((s, i) => { s.textContent = fmt((dur * i) / (rulerSpans.length - 1)); });

    let vimeoApi = null;
    const loadVimeoApi = () => vimeoApi || (vimeoApi = new Promise((resolve, reject) => {
      if (window.Vimeo && window.Vimeo.Player) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://player.vimeo.com/api/player.js';
      s.onload = resolve;
      s.onerror = () => { vimeoApi = null; reject(); };
      document.head.appendChild(s);
    }));

    const closeProject = () => {
      if (!video) return;
      if (video.player) unregister(video.player);
      video = null;
      frameBox.innerHTML = emptyHTML;
      playerTitle.textContent = titleDefault;
      closeBtn.hidden = true;
      playerBox.classList.remove('is-playing');
      mockEl.classList.remove('has-video');
      qBtns.forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
      rulerSpans.forEach((s, i) => { s.textContent = rulerDefault[i]; });
      if (seqTitle) seqTitle.textContent = seqDefault;
      tracks.classList.remove('has-film');
      tracks.style.removeProperty('--film');
      geo = null;
      mode = ''; lastP = -1;
      seek(0); render(0);
    };

    // Only one video plays at a time across the page (hero player + Work section reels)
    const players = new Set();
    const register = (pl) => {
      players.add(pl);
      pl.on('play', () => players.forEach((o) => { if (o !== pl) o.pause().catch(() => {}); }));
    };
    const unregister = (pl) => { players.delete(pl); pl.destroy().catch(() => {}); };

    // Player footer: play / pause button that mirrors the video
    const pfPlay = document.querySelector('.pf-play');
    const pfIcon = pfPlay && pfPlay.querySelector('.pf-icon');
    const setPlaying = (on) => {
      if (!pfPlay) return;
      pfPlay.setAttribute('aria-label', on ? 'Pause' : 'Play');
      pfIcon.setAttribute('d', on ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5l11 6.5-11 6.5z');
    };
    if (pfPlay) pfPlay.addEventListener('click', () => {
      if (!video) return;
      if (!video.player) { mountPlayer(video); setPlaying(true); return; } // first press loads the video
      video.player.getPaused().then((paused) => (paused ? video.player.play() : video.player.pause())).catch(() => {});
    });

    // Load the real Vimeo player for the current project (only when someone presses play,
    // so the page stays light). Starts where the playhead is.
    const mountPlayer = (current) => {
      const start = Math.floor((current.p || 0) * (current.duration || 0));
      const iframe = document.createElement('iframe');
      iframe.src = `https://player.vimeo.com/video/${current.id}?autoplay=1&badge=0&title=0&byline=0&portrait=0&dnt=1${start ? `#t=${start}s` : ''}`;
      iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      iframe.title = `${current.name}, sample project by Michael Angelo Mangaser`;
      frameBox.innerHTML = '';
      frameBox.appendChild(iframe);
      mockEl.classList.add('has-video');

      loadVimeoApi().then(() => {
        if (video !== current) return; // another project was picked meanwhile
        const pl = new window.Vimeo.Player(iframe);
        current.player = pl;
        register(pl);
        pl.on('play', () => { if (video === current) setPlaying(true); });
        pl.on('pause', () => { if (video === current) setPlaying(false); });
        pl.on('ended', () => { if (video === current) setPlaying(false); });
        pl.on('timeupdate', (d) => {
          if (video !== current) return;
          current.duration = d.duration;
          current.p = d.percent;
          p = d.percent;
          render(p);
        });
      }).catch(() => { /* API blocked: the video still plays, the timeline just won't follow it */ });
    };

    // Thumbnail with a play button: looks loaded, costs almost nothing until clicked
    const showPoster = (current, thumb) => {
      frameBox.innerHTML = '';
      const poster = document.createElement('button');
      poster.type = 'button';
      poster.className = 'player-poster';
      poster.setAttribute('aria-label', `Play ${current.name}`);
      if (thumb) {
        const img = document.createElement('img');
        img.src = thumb; img.alt = ''; img.decoding = 'async';
        poster.appendChild(img);
      }
      const icon = document.createElement('span');
      icon.className = 'player-poster-play';
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/></svg>';
      poster.appendChild(icon);
      poster.addEventListener('click', () => { if (video === current) mountPlayer(current); });
      frameBox.appendChild(poster);
    };

    // autoplay = true when a visitor picks a project; false for the one shown on page open
    const openProject = (btn, autoplay = true) => {
      if (!playerBox) return;
      const name = btn.querySelector('.q-name').textContent;
      if (video && video.player) unregister(video.player);
      if (exportFrom >= 0) { exportFrom = -1; playhead.classList.remove('exporting'); }
      qBtns.forEach((b) => { const on = b === btn; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });

      const duration = Number(btn.dataset.dur) || 0;
      const current = { player: null, p: 0, duration, name, id: btn.dataset.vimeo };
      video = current;
      playerTitle.textContent = name;
      playerBox.classList.add('is-playing');
      if (status) status.textContent = name;
      if (seqTitle) seqTitle.textContent = `Sequence · ${btn.dataset.seq}`;
      if (duration) setRuler(duration);
      // Details panel, player footer and the V1 clip label
      const setText = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = text; };
      setText('.d-type', btn.dataset.type || 'Ad edit');
      setText('.d-len', fmt(duration));
      setText('.v1-label', `${btn.dataset.seq}.mp4 · ${fmtTC(duration)}`);
      if (pfDur) pfDur.textContent = fmtTC(duration);
      setPlaying(false);
      // Filmstrip: show this video's vertical frames on the V1 track
      if (btn.dataset.thumb) {
        tracks.style.setProperty('--film', `url("${btn.dataset.thumb}")`);
        tracks.classList.add('has-film');
      }
      geo = null; // V1 gets taller with the filmstrip, so re-measure the timeline
      p = 0; lastP = -1; render(0);

      if (autoplay) mountPlayer(current);
      else { mockEl.classList.remove('has-video'); showPoster(current, btn.dataset.thumb); }

      // On phones the player sits under the queue, so bring it into view when someone picks a project
      if (autoplay && window.matchMedia('(max-width: 640px)').matches) {
        playerBox.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
      }
    };

    qBtns.forEach((b) => b.addEventListener('click', () => {
      if (video && b.classList.contains('is-active') && video.player) return;
      openProject(b);
    }));
    if (closeBtn) closeBtn.addEventListener('click', closeProject);

    // On page open: show a random project, ready to play (thumbnail only, nothing heavy loaded)
    if (qBtns.length) openProject(qBtns[Math.floor(Math.random() * qBtns.length)], false);

    // Pause the editor's video when the visitor scrolls away from it
    if ('IntersectionObserver' in window && mockEl) {
      new IntersectionObserver(([entry]) => {
        if (entry.intersectionRatio < 0.3 && video && video.player) video.player.pause().catch(() => {});
      }, { threshold: [0, 0.3] }).observe(mockEl);
    }

    // Work section reels: hook them up when the visitor gets near them, so they pause each
    // other and the editor player, and pause themselves when scrolled out of view
    const work = document.querySelector('#work');
    const reelFrames = [...document.querySelectorAll('.reel iframe')];
    if (work && reelFrames.length && 'IntersectionObserver' in window) {
      const nearWork = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        nearWork.disconnect();
        loadVimeoApi().then(() => {
          const byFrame = new Map();
          reelFrames.forEach((f) => { const pl = new window.Vimeo.Player(f); register(pl); byFrame.set(f, pl); });
          const outOfView = new IntersectionObserver((list) => list.forEach((e) => {
            if (!e.isIntersecting) { const pl = byFrame.get(e.target); if (pl) pl.pause().catch(() => {}); }
          }), { threshold: 0 });
          reelFrames.forEach((f) => outOfView.observe(f));
        }).catch(() => {});
      }, { rootMargin: '400px 0px' });
      nearWork.observe(work);
    }
    ratioBtns.forEach((b) => b.addEventListener('click', () => {
      ratio = b.dataset.ratio;
      ratioBtns.forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
      // Reshape the player canvas (the video stays inside it, letterboxed like in an editor)
      if (frameBox) {
        frameBox.dataset.ratio = ratio;
        frameBox.classList.remove('ratio-pop');
        void frameBox.offsetWidth; // restart the little pop animation
        frameBox.classList.add('ratio-pop');
      }
      lastP = -1; geo = null; // layout shifted a little, so re-measure the timeline
      if (ratioPill) {
        ratioPill.textContent = ratio;
        const pfRatio = document.querySelector('.pf-ratio');
        if (pfRatio) pfRatio.textContent = ratio;
        ratioPill.classList.add('bump');
        setTimeout(() => ratioPill.classList.remove('bump'), 250);
      }
    }));

    if (reduceMotion) {
      seek(0.12); render(p);
      // without animation, tab clicks just jump; export shows "ready" straight away
    } else {
      const tick = (now) => {
        if (exportFrom >= 0) {
          if (renderExport(now - exportT0)) { endExport(); if (video) p = video.p; render(p); }
        } else if (video) {
          p = video.p; // the playing video drives the playhead (updated by Vimeo's timeupdate)
          render(p);
        } else {
          p = ((now - t0) % CYCLE) / CYCLE;
          render(p);
        }
        raf = visible ? requestAnimationFrame(tick) : 0;
      };
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !raf) raf = requestAnimationFrame(tick);
      }).observe(timeline);
      render(0);
    }
  }

  document.getElementById('year').textContent = new Date().getFullYear();
})();
