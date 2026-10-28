FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends pandoc zip \
    && rm -rf /var/lib/apt/lists/*
USER 65534:65534
WORKDIR /work
ENTRYPOINT ["/usr/bin/pandoc"]
