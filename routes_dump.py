from app.main import app
paths = sorted({r.path for r in app.routes})
print("\n".join(paths))
