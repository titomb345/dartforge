FROM rust:1.83-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/dartforge-proxy /usr/local/bin/
ENV BIND_ADDR=0.0.0.0:8080
EXPOSE 8080
CMD ["dartforge-proxy"]
