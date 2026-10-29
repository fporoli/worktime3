case $- in
  *a*) _env_sh_allexport_was_set=1 ;;
  *) _env_sh_allexport_was_set=0 ;;
esac

set -a
. ./.env.dev
_env_sh_status=$?

if [ "$_env_sh_allexport_was_set" -eq 1 ]; then
  set -a
else
  set +a
fi

unset _env_sh_allexport_was_set
return "$_env_sh_status"
