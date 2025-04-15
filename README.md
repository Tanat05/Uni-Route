# 📍 Uni-Route (유니루트)

캠퍼스 생활을 한층 더 편리하게 만들어 줄 캠퍼스 안내 지도 서비스입니다. 🗺️

⚠️ 중요: 이 코드는 순천향대학교 캠퍼스에 맞춤화되어 있습니다. 다른 학교 캠퍼스에서 사용하려면 아래 설명된 설정 파일(*.json)의 수정이 반드시 필요합니다.

~~건물 내부 지도를 보여주는 기능도 있지만 미완~~

# 🚀 Preview

서비스 미리보기: https://tanat.kr/soon/

![alt text](https://github.com/user-attachments/assets/c18ac273-6e4e-4273-b202-f133d0849378)

# ✨ 주요 기능

- 캠퍼스 지도: 상세한 캠퍼스 지도를 제공합니다.

- 건물 및 강의실 검색: 건물 이름, 별명, 또는 강의실 코드로 위치를 검색할 수 있습니다.

- 편의시설 안내: 교내 식당, 카페, 은행 등 다양한 편의시설 정보를 제공합니다.

- 경로 안내 (설정 기반): 설정된 노드와 엣지를 기반으로 경로를 표시할 수 있습니다. (기능 구현에 따라 다름)

- 관리자 모드: 웹 인터페이스를 통해 경로 노드와 엣지를 시각적으로 편집할 수 있습니다.

# 🛠️ 설정 (Configuration)

Uni-Route는 여러 JSON 파일을 통해 캠퍼스 데이터를 설정합니다.

## 1. config.json - 기본 지도 설정

지도가 처음 열릴 때 표시될 기본 위치(중심 좌표)를 설정합니다.

- lat: 기본 지도의 위도 (Latitude)

- lng: 기본 지도의 경도 (Longitude)

```json
// 예시: config.json
{
  "lat": 36.768,
  "lng": 126.93
}
```

## 2. buildings.json - 건물 정보

캠퍼스 내 건물들의 정보를 정의합니다.

- id: 건물의 고유 ID (형식: B01 ~ B99)

- name: 건물의 공식 명칭 (예: "멀티미디어관")

- code: 강의실 검색 시 사용될 건물의 코드 (예: 강의실 ML304 검색 시 ML 부분)

- lat: 건물의 위도

- lng: 건물의 경도

- nicknames: 건물의 별명 또는 약칭 (배열 형태, 검색 시 활용됨, 예: ["멀관", "Multimedia Building"])

```json
// 예시: buildings.json
[
  {
    "id": "B01",
    "name": "미디어랩스관",
    "code": "ML",
    "lat": 36.7681,
    "lng": 126.9312,
    "nicknames": ["미랩"]
  }
  // ... 다른 건물들
]
```

## 3. classrooms.json - 강의실 정보

각 건물 내 강의실의 상세 정보를 정의합니다.

- id: 강의실의 고유 ID (형식: C001 ~ C999)

- buildingId: 이 강의실이 속한 건물의 id (buildings.json의 id와 연결)

- floor: 강의실이 위치한 층수 (숫자)

- room: 강의실 호수 (문자열, 예: "304", "B101")

- fullName (선택 사항): 강의실의 전체 이름 (예: "ML304", 없을 경우 건물코드 + room 조합 등으로 사용될 수 있음)

```json
// 예시: classrooms.json
[
  {
    "id": "C001",
    "buildingId": "B01",
    "floor": 3,
    "room": "304",
    "fullName": "ML304"
  }
  // ... 다른 강의실들
]
```

## 4. facilities.json - 편의시설 정보

식당, 카페, 은행 등 캠퍼스 내 편의시설 정보를 정의합니다.

- id: 편의시설의 고유 ID (형식: F01 ~ F99)

- name: 편의시설 이름 (예: "학생 식당", "카페 OOO")

- type: 편의시설 카테고리 (예: "restaurant", "cafe", "bank", "store")

- lat: 편의시설의 위도

- lng: 편의시설의 경도

- buildingId (선택 사항): 편의시설이 특정 건물 내부에 위치할 경우 해당 건물의 id

- description (선택 사항): 추가 설명 (운영 시간 등)

- color (선택 사항): 지도에 표시될 마커의 색상 (CSS 색상 코드, 예: "#FF5733")

```json
// 예시: facilities.json
[
  {
    "id": "F01",
    "name": "중앙 도서관",
    "type": "library",
    "lat": 36.7675,
    "lng": 126.9320,
    "buildingId": "B05",
    "description": "월-금 09:00-21:00",
    "color": "#4CAF50"
  }
  // ... 다른 편의시설들
]
```

## 5. pathNodes.json & pathEdges.json - 경로 정보

캠퍼스 내 이동 경로를 정의하는 노드(지점)와 엣지(연결선) 데이터입니다.

- 관리자 모드: 웹 브라우저에서 서비스 URL 뒤에 ?code=admin을 추가하여 접속하면 (예: https://tanat.kr/soon/?code=admin), 경로 노드를 추가하고 엣지를 연결하는 관리자 모드가 활성화됩니다.

- 적용 방법: 관리자 모드에서 노드와 엣지를 모두 수정한 후, '내보내기(Export)' 기능을 통해 pathNodes.json과 pathEdges.json 파일을 다운로드 받아 프로젝트에 적용하면 됩니다.

# 📌 Tip: 좌표 얻기

지도 상의 특정 위치의 위도(Latitude)와 경도(Longitude)를 쉽게 얻을 수 있습니다.

웹 브라우저에서 Uni-Route 사이트에 접속합니다.

좌표를 알고 싶은 지도 위의 위치에서 마우스 오른쪽 버튼을 클릭합니다.

클릭한 지점의 위도와 경도 좌표가 화면에 표시됩니다. 이 좌표를 config.json, buildings.json, facilities.json 등의 설정 파일에 활용하세요.

# 📜 Credits & License

- 지도 데이터: © OpenStreetMap contributors

- 지도 라이브러리 (Leaflet): © 2010–2024 Volodymyr Agafonkin

- Uni-Route 개발: Copyright © 2025 Tanat. All rights reserved.
