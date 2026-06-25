"""Blogs / CMS endpoints."""
from __future__ import annotations
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


class BlogBody(BaseModel):
    title: str
    slug: str
    content: str
    cover_image: Optional[str] = None
    excerpt: str = ""
    tags: List[str] = []
    published: bool = True


def make_router(
    *,
    db,
    admin_only: Callable,
    utcnow: Callable,
    new_id: Callable,
    clean: Callable,
) -> APIRouter:
    r = APIRouter()

    @r.post("/admin/blogs")
    async def admin_create_blog(body: BlogBody, _: dict = Depends(admin_only)):
        doc = body.model_dump()
        doc["id"] = new_id()
        doc["created_at"] = utcnow()
        await db.blogs.insert_one(doc)
        return clean(doc)

    @r.get("/blogs")
    async def list_blogs(published_only: bool = True):
        q = {"published": True} if published_only else {}
        docs = await db.blogs.find(q).sort("created_at", -1).to_list(100)
        return [clean(d) for d in docs]

    @r.get("/blogs/{slug}")
    async def get_blog(slug: str):
        doc = await db.blogs.find_one({"slug": slug})
        if not doc:
            raise HTTPException(404, "Not found")
        return clean(doc)

    return r
