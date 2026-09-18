import cv2, numpy as np
img = np.full((800, 1200, 3), 255, np.uint8)
T = 8  # 벽 두께
def wall(x1,y1,x2,y2): cv2.rectangle(img,(x1,y1),(x2,y2),(20,20,20),-1)
# 외벽
wall(100,100,1100,100+T); wall(100,700-T,1100,700); wall(100,100,100+T,700); wall(1100-T,100,1100,700)
# 내벽(문 자리 비움)
wall(500,100,500+T,350); wall(500,430,500+T,700)      # 세로 내벽, 350~430 출입구
wall(100,400,300,400+T); wall(380,400,500,400+T)      # 가로 내벽, 300~380 출입구
wall(800,100,800+T,250); wall(800,330,800+T,700)
# 현관 (외벽 끊김)
img[700-T:700, 600:680] = 255
# 얇은 선: 가구·문 호·글자
cv2.rectangle(img,(150,150),(300,260),(60,60,60),1)
cv2.ellipse(img,(500,350),(80,80),0,0,90,(60,60,60),1)
cv2.ellipse(img,(300,400),(80,80),0,270,360,(60,60,60),1)
cv2.putText(img,"BEDROOM",(160,320),cv2.FONT_HERSHEY_SIMPLEX,0.7,(30,30,30),1)
cv2.putText(img,"KITCHEN",(880,500),cv2.FONT_HERSHEY_SIMPLEX,0.7,(30,30,30),1)
cv2.circle(img,(950,300),40,(60,60,60),1)
cv2.imwrite("test_plan.png", img)
