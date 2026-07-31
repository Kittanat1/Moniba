from config import Config
from flask import Flask
from models import db, User

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

with app.app_context():
    db.create_all()
    print("สร้างตารางสำเร็จ!")

    u = User(line_user_id="test-001", display_name="ทดสอบ")
    db.session.add(u)
    db.session.commit()
    print("เพิ่ม user สำเร็จ:", u.to_dict())