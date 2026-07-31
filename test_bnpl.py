from datetime import date
from config import Config
from flask import Flask
from models import db, User, BNPLItem

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

with app.app_context():
    db.create_all()  

    user = User.query.filter_by(line_user_id="test-001").first()
    print("เจอ user:", user.to_dict())

    item = BNPLItem(
        user_id=user.id,
        item_name="iPhone 15",
        total_amount=30000,
        installment_amount=2500,
        installments_total=12,
        due_date=date(2026, 8, 1),
    )
    db.session.add(item)
    db.session.commit()
    print("เพิ่มรายการสำเร็จ:", item.to_dict())

    print("รายการทั้งหมดของ user นี้:")
    for i in user.bnpl_items:
        print(" -", i.item_name)