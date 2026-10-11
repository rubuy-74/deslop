const SUPPORTED_HOSTS = [
  { hosts: ['www.youtube.com', 'youtube.com'], path: /^\/shorts(?:\/|$)/ },
  { hosts: ['www.tiktok.com', 'tiktok.com'], path: /^\/(?:foryou(?:\/|$))?$/ },
  { hosts: ['www.instagram.com', 'instagram.com'], path: /^\/reels(?:\/|$)/ },
];

export function isSupportedTabUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return SUPPORTED_HOSTS.some(
    ({ hosts, path }) => hosts.includes(url.hostname) && path.test(url.pathname),
  );
}

export function shouldActivateExistingTabs(reason) {
  return reason === 'install' || reason === 'update';
}

export async function activateExistingTabs({ queryTabs, inject }) {
  const tabs = await queryTabs();
  const eligibleTabs = tabs.filter(
    (tab) => Number.isInteger(tab?.id) && isSupportedTabUrl(tab.url),
  );

  return Promise.allSettled(eligibleTabs.map((tab) => inject(tab.id)));
}
