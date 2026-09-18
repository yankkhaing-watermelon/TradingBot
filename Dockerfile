FROM python:3.12-slim
WORKDIR /app
COPY app.py research.py gmail_sync.py ./
COPY static ./static
RUN useradd --uid 10001 --create-home app && mkdir /data && chown app:app /data
USER app
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["python", "app.py"]
