#!/bin/sh
set -eu
test "$#" = 1
# TikZ's only permitted command accepts a generated basename, not options,
# source paths, TeX fragments, shell syntax or arbitrary engine arguments.
case "$1" in output-figure[0-9]*) ;; *) exit 64 ;; esac
suffix="${1#output-figure}"
case "$suffix" in ''|*[!0-9]*) exit 64 ;; esac
exec pdflatex -no-shell-escape -halt-on-error -interaction=batchmode \
  "-jobname=$1" '\def\tikzexternalrealjob{output}\input{main.tex}'
