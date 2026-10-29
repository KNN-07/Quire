#!/bin/sh
set -eu
profile="$1"
engine="$2"
main="$3"
stop="${4:-true}"
draft="${5:-false}"
case "$stop:$draft" in true:true|true:false|false:true|false:false) ;; *) exit 64 ;; esac
case "$profile" in default|restricted|knitr) ;; *) exit 64 ;; esac
case "$engine" in
  pdflatex) mode="-pdf" ;;
  latex) mode="-pdfdvi" ;;
  xelatex) mode="-xelatex" ;;
  lualatex) mode="-lualatex" ;;
  plain) mode="-pdf" ;;
  *) exit 64 ;;
esac
cd /work
cp -R /src/. .
find /work -mindepth 1 -exec chmod u+w {} +
mkdir -p tmp cache
export TMPDIR=/work/tmp XDG_CACHE_HOME=/work/cache
knit=""
if [ "$profile" = knitr ]; then
  case "$main" in
    main.Rnw|main.Rtex) knit="$main" ;;
    main.tex)
      if [ -f main.Rnw ]; then knit=main.Rnw
      elif [ -f main.Rtex ]; then knit=main.Rtex
      fi ;;
  esac
fi
if [ -n "$knit" ]; then
  Rscript --vanilla -e 'knitr::opts_chunk$set(cache=FALSE); knitr::opts_hooks$set(cache=function(options) { if (!isTRUE(options$cache == 0)) stop("QUIRE_KNITR_CACHE_UNSUPPORTED: use cache=FALSE; chunk caches are not retained between jobs", call.=FALSE); options }); knitr::knit(commandArgs(TRUE)[1], output="main.tex", quiet=TRUE)' "$knit" >&2
  main=main.tex
fi
escape="-no-shell-escape"
if [ "$profile" = restricted ]; then
  escape="-shell-restricted"
  export shell_escape_commands=latexminted,quire-tikz
fi
set -- -norc
if [ -f /etc/LatexMk ]; then set -- "$@" -r /etc/LatexMk; fi
if [ -f .latexmkrc ]; then
  set -- "$@" -r .latexmkrc
elif [ -f latexmkrc ]; then
  set -- "$@" -r latexmkrc
fi
set -- "$@" -e '$dvipdf="dvipdfmx %O -o %D %S"' "$mode" \
  -interaction=nonstopmode -file-line-error -synctex=1 \
  -recorder -jobname=output "-latexoption=$escape"
if [ "$stop" = true ]; then set -- "$@" -halt-on-error; fi
if [ "$draft" = true ]; then
  set -- "$@" '-pretex=\PassOptionsToPackage{draft}{graphicx}' -usepretex
fi
if [ "$engine" = plain ]; then set -- "$@" "-pdflatex=pdftex %O %S"; fi
code=0
latexmk "$@" "./$main" >&2 || code=$?
if [ "$code" = 0 ]; then
  pdfinfo output.pdf >&2 && pdftoppm -scale-to 16 -singlefile output.pdf validation >&2 \
    && pdftotext output.pdf output.txt || code=65
fi
printf '%s\n' "$code" > exit-code
# Source remains read-only at /src; only generated files are returned.
find . -type f ! -path './tmp/*' ! -path './cache/*' \
  ! -path './texmf-var/*' ! -path './texmf-config/*' -print0 \
  | xargs -0 -r sh -c 'for path do
      if [ ! -f "/src/$path" ]; then printf "%s\0" "$path"; fi
    done' quire \
  | tar --null --format=ustar -T - -cf -
exit "$code"
