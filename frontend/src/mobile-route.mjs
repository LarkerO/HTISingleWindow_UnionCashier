export function mobileCheckout(pathname, search, userAgent, touchPoints = 0) {
  const id = /^\/checkout\/([a-f0-9]{32})$/.exec(pathname)?.[1];
  if (!id || new URLSearchParams(search).get('desktop') === '1') return null;
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && touchPoints > 1);
  return mobile ? '/mobile/checkout/' + id : null;
}
