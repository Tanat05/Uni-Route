# Uni-Route

Uni-Route (유니루트)는 캠퍼스 생활을 한층 더 편리하게 만들어 줄 캠퍼스 안내 지도 서비스입니다.
해당 코드는 순천향대학교에 맞춤화된 코드입니다. 다른 학교의 캠퍼스에서 사용 시 코드의 수정이 필요할 수 있습니다.

# Preview
https://tanat.kr/soon/
![image](https://github.com/user-attachments/assets/c18ac273-6e4e-4273-b202-f133d0849378)

# Setting
- config.json 기본설정
  - 지도가 열리면 보일 기본 좌표를 설정
  - lat: 위도, 아래 팁을 확인하세요
  - lng: 경도, 아래 팁을 확인하세요
- buildings.json 건물
  - id: B01 ~ B99 
  - name: 건물 이름
  - code: 강의실 검색 시 사용될 맨 앞자리 코드(ex. 강의실 검색 시 `ML304`에서 `ML`해당 부분)
  - lat: 건물의 위도, 아래 팁을 확인하세요
  - lng: 건물의 경도, 아래 팁을 확인하세요
  - nicknames: 별명 (검색에서만 사용됨)
- classrooms.json: 강의실
  - id: C001 ~ C999
  - buildingId: 해당 강의실이 위치한 건물의 id
  - floor: 층수
  - room: 호실
  - fullName: 강의실 이름(선택)
- facilities.json 편의시설
  - id: F01 ~ F99
  - name: 이름
  - type: 카테고리
  - lat: 위도
  - lng: 경도
  - buildingId: 편의시설이 포함된 건물의 id
  - description: 설명
  - color: 지도에 표시될 색상
- pathEdges.json & pathNodes.json
  - 웹으로 접속 후 `?code=admin`을 주소에 입력하면 노드를 추가하고 엣지를 연결 할 수 있는 관리자 모드가 활성화 됩니다.
  - 노드와 엣지를 모두 수정하고 내보내기를 통해 파일을 다운받아 적용하면 됩니다.

# Tip
- 위도와 경도 설정 시 웹으로 접속 후 지도를 우클릭하면 해당 위치의 좌표가 표시됩니다.

#
© 2010–2025 Volodymyr Agafonkin. Maps © OpenStreetMap contributors.
Copyright © 2025 Tanat. All rights reserved.
