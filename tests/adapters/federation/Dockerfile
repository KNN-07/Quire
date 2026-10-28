FROM debian:bookworm-slim
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends slapd ldap-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["slapd", "-d", "256", "-f", "/fixture/slapd.conf", "-h", "ldaps://0.0.0.0:636"]
