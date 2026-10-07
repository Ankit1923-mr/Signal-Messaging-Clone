"""
Main FastAPI application for Signal Clone messaging app.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.auth import router as auth_router
from app.routes.ws import router as ws_router

# Initialize FastAPI app
app = FastAPI(
    title="Signal Clone API",
    description="Secure messaging application API",
    version="1.0.0"
)

# CORS middleware
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url],
    allow_credentials=True,  # Allow cookies
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)

# Include routers
app.include_router(auth_router)
app.include_router(ws_router)


@app.get("/", tags=["Health"])
def health_check():
    """Health check endpoint."""
    return {"status": "ok", "message": "Signal Clone API is running"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
