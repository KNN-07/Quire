FROM python:3.13-slim@sha256:b3575dcf816cdacc5292df77a6e3e59b8941631078373a045efa2ac1e9c5c3b2 AS helper-python
FROM ubuntu:26.04@sha256:157dc3d6e4a3e4f2c68d12df9df9ed6e808b59af6d4c3757b432b4f519916725
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-base=2025.20260124-1 texlive-binaries=2025.20250727.75242+ds-5build1 \
    texlive-latex-extra texlive-xetex texlive-luatex texlive-science \
    texlive-fonts-recommended latexmk=1:4.87~ds-1 biber=2.21-2 \
    r-base-core=4.5.2-1ubuntu2 r-cran-knitr=1.51+dfsg-1 \
    python3-pygments poppler-utils fontconfig fonts-dejavu-core ca-certificates \
    && mkdir /opt/quire \
    && dpkg-query -W > /opt/quire/packages.tsv \
    && sha256sum /opt/quire/packages.tsv > /opt/quire/packages.sha256 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=helper-python /usr/local/ /usr/local/
RUN ldconfig && apt-get update && apt-get install -y --no-install-recommends \
    texlive-bibtex-extra=2025.20260124-1 && rm -rf /var/lib/apt/lists/*
COPY compile.sh /usr/local/bin/quire-compile
COPY tikz.sh /usr/local/bin/quire-tikz
RUN chmod 0555 /usr/local/bin/quire-compile /usr/local/bin/quire-tikz \
    && (dpkg-query -W; python3 --version; sha256sum /usr/local/bin/python3.13 /usr/local/bin/quire-compile /usr/local/bin/quire-tikz) > /opt/quire/packages.tsv \
    && sha256sum /opt/quire/packages.tsv > /opt/quire/packages.sha256
ENV PATH=/usr/local/bin:/usr/bin:/bin HOME=/work LANG=C.UTF-8 \
    TEXMFVAR=/work/texmf-var TEXMFCONFIG=/work/texmf-config \
    TEXINPUTS=/work//: BIBINPUTS=/work//: \
    openout_any=p
WORKDIR /work
USER 65534:65534
