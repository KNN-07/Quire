ARG PANDOC_IMAGE=quire-pandoc:local
FROM ${PANDOC_IMAGE}
USER 0:0
RUN mv /usr/bin/pandoc /usr/bin/pandoc-real
COPY tests/operations/installation/supervisor-execution/pandoc-fixture.sh /usr/bin/pandoc
RUN chmod 755 /usr/bin/pandoc
ARG DELAY_PROBE=0
ENV P74_DELAY_PROBE=${DELAY_PROBE}
USER 65534:65534
