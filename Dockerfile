FROM oven/bun:1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV PORT=3000
ENV SUBMISSIONS_DIR=/data/submissions
EXPOSE 3000
CMD ["bun", "server.ts"]
