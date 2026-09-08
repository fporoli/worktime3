import Keycloak from 'keycloak-js';

const url = import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8091';
const realm = import.meta.env.VITE_KEYCLOAK_REALM ?? 'worktime';
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT ?? 'worktime-web';

export const keycloak = new Keycloak({ url, realm, clientId });
export async function login() {
  await keycloak.init({ onLoad: 'login-required', checkLoginIframe: false });
}
