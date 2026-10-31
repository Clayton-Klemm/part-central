FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 API_WORKERS=4
WORKDIR /srv/api
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ ./
COPY data/ /srv/data/
RUN useradd --create-home --uid 10001 partcentral && mkdir -p /srv/assets && chown -R partcentral:partcentral /srv
USER partcentral
EXPOSE 8000
CMD ["sh", "-c", "python -m alembic upgrade head && python -m app.seed && exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers \"${API_WORKERS:-4}\""]
