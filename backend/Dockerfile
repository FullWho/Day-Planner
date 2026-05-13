FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download || true

COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine:3.20

WORKDIR /app
COPY --from=builder /app/server /app/server
RUN mkdir -p /app/data

ENV DB_PATH=/app/data/planner.db
ENV CORS_ORIGIN=http://localhost:5173
ENV JWT_SECRET=change-me-in-production

EXPOSE 8080
CMD ["/app/server"]
