"""Customers router: GET /api/customers/{customer_id} (plan Section 14)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.security import get_current_user
from app.services.review import customer_profile

router = APIRouter(prefix="/api/customers", tags=["Customers"], dependencies=[Depends(get_current_user)])


@router.get("/{customer_id}")
def get_customer(customer_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    profile = customer_profile(db, customer_id)
    if profile is None:
        raise HTTPException(status_code=404, detail=f"Customer {customer_id} not found")
    return profile
