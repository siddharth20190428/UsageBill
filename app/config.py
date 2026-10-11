import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://usagebill:usagebill@localhost:5432/usagebill",
)
