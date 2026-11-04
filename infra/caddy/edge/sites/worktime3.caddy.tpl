# Template for one worktime3 instance's site block on the shared edge Caddy. Not served as
# is: infra/vps/remote.sh renders it to /opt/edge/sites/<prefix>.caddy on every deploy,
# filling in the instance's hostnames and container prefix, then reloads Caddy. Do not edit
# the rendered copy on the VPS; it gets overwritten. Edit this file instead.
#
# Proxies to the containers by their explicit container_name (not the bare service name):
# the edge Caddy only sees them over the shared "edge" network, where a bare service name
# alias would collide between instances and with other projects' same-named services (e.g.
# worktime2 also has a service called "api"). The prefix keeps every instance's names unique.
__WEB_HOST__ {
  reverse_proxy __PREFIX__-web:80
}
__API_HOST__ {
  reverse_proxy __PREFIX__-api:8000
}
__AUTH_HOST__ {
  reverse_proxy __PREFIX__-keycloak:8080
}
