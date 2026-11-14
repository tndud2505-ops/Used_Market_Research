// Reuse KSTOCK's short, viewport-gated motion without requesting paid ads.
export function createHousePromotion(root) {
  root.hidden = true;
  let eligible = false;
  let visible = false;
  let userPaused = false;
  let userPlaying = false;
  const video = root.querySelector?.('video.train-gallery-moa');
  const exercise = root.querySelector?.('.train-gallery-editor video');
  const toggle = root.querySelector?.('[data-motion-toggle]');
  let update = () => {};

  if (video && typeof IntersectionObserver !== 'undefined') {
    const desktop = window.matchMedia('(min-width: 861px)');
    const motion = window.matchMedia('(min-width: 861px) and (prefers-reduced-motion: no-preference)');
    const clips = [video, exercise].filter(Boolean);
    for (const clip of clips) clip.muted = true;
    const pause = () => { for (const clip of clips) clip.pause(); };
    const play = () => {
      for (const clip of clips) {
        if (!clip.getAttribute('src')) clip.src = clip.dataset.motionSrc || clip.dataset.src;
      }
      void video.play().then(() => {
        if (exercise && !video.paused && !video.ended) {
          exercise.currentTime = video.currentTime;
          void exercise.play().catch(() => {});
        }
      }).catch(() => exercise?.pause());
    };
    update = () => {
      if (toggle) toggle.hidden = !desktop.matches;
      if (!eligible || !visible || !desktop.matches || (!motion.matches && !userPlaying) || document.hidden || userPaused) {
        pause();
        return;
      }
      if (video.ended) return;
      // Both approved clips are 4.5 seconds, have no audio, and never loop.
      play();
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      update();
    }, { threshold: [0, 0.5] });
    observer.observe(video);
    desktop.addEventListener('change', update);
    motion.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pagehide', pause);
    const reflectPlayback = () => {
      const playing = !video.paused && !video.ended;
      if (!playing) exercise?.pause();
      if (!toggle) return;
      toggle.textContent = playing ? 'Ⅱ' : '▶';
      toggle.setAttribute('aria-label', playing ? '배너 동작 일시정지' : '배너 동작 재생');
    };
    video.addEventListener('play', reflectPlayback);
    video.addEventListener('pause', reflectPlayback);
    video.addEventListener('ended', reflectPlayback);
    toggle?.addEventListener('click', () => {
      if (!eligible || !desktop.matches) return;
      if (!video.paused) {
        userPaused = true;
        pause();
      } else {
        userPaused = false;
        // Reduced-motion users can explicitly choose to play the short clip.
        userPlaying = true;
        if (video.ended) {
          video.currentTime = 0;
          if (exercise) exercise.currentTime = 0;
        }
        update();
      }
    });
  }

  return {
    setEligible(value) {
      eligible = Boolean(value);
      root.hidden = !eligible;
      update();
    }
  };
}
