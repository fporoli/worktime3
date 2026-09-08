import Keycloak from 'keycloak-js';

const url = import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8091';
const realm = import.meta.env.VITE_KEYCLOAK_REALM ?? 'worktime';
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT ?? 'worktime-web';

export const keycloak = new Keycloak({ url, realm, clientId });

let initPromise: Promise<boolean> | null = null;

/** Init once (StrictMode mounts twice); resolves true when logged in via SSO. */
export function ensureSsoInit(): Promise<boolean> {
  if (!initPromise) {
    initPromise = keycloak
      .init({ onLoad: 'check-sso', checkLoginIframe: false, pkceMethod: 'S256' })
      .catch(() => false);
  }
  return initPromise;
}

export function startSsoLogin(): Promise<void> {
  return keycloak.login({ redirectUri: window.location.origin + window.location.pathname });
}

/** Refresh the access token when it expires within `minValiditySec`. */
export async function refreshSsoToken(minValiditySec = 30): Promise<boolean> {
  try {
    return await keycloak.updateToken(minValiditySec);
  } catch {
    return false;
  }
}

export function ssoLogout(): Promise<void> {
  initPromise = null;
  return keycloak.logout({ redirectUri: window.location.origin + window.location.pathname });
}

export async function login() {
  await keycloak.init({ onLoad: 'login-required', checkLoginIframe: false });
}
