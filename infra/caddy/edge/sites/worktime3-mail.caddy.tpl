# Optional block for one instance's Mailpit web UI (its inbox), appended to the instance's
# site file by infra/vps/remote.sh when the MAIL_SUB variable is set. Mailpit has no login of
# its own, so Caddy gates it with Basic Auth: user `admin`, the bcrypt hash below (the
# password is NOT stored in this repo). Regenerate the hash with:
#   docker run --rm caddy:2 caddy hash-password --plaintext '<new password>'
__MAIL_HOST__ {
  basic_auth {
    admin $2a$14$1KdNs5KtSWfofAa9FNLXROpDST/1sgfgESYNHOKT2q68H3rcCVuA.
  }
  reverse_proxy __PREFIX__-mailpit:8025
}
