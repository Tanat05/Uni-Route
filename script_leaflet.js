document.addEventListener('DOMContentLoaded', () => {
    let schLocation = null; let buildingsData = []; let classroomsData = [];
    let facilitiesData = []; let pathNodesData = []; let pathEdgesData = [];
    let pathGraph = {}; let map = null; let fuse = null;
    let searchMarkers = L.layerGroup(); let routeLayer = L.layerGroup();
    let facilityCategoryLayers = {}; let currentlyDisplayedFacilityLayer = null;
    let currentlyDisplayedFacilityType = null; let startLocation = null; let endLocation = null;
    let searchableData = []; let availableFacilityTypes = new Set();
    let userLocationMarker = null;
    let locationWatchId = null;
    let findRouteDebounceTimer = null;
    let indoorSegmentMarkers = L.layerGroup();
    let currentUserPreference = 'fastest';

    let isAdminMode = false;
    let adminNodeMarkersLayer = L.layerGroup();
    let adminEdgeLayer = L.layerGroup();
    let firstNodeForEdge = null;
    let selectedMarkerForEdge = null;

    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const searchResultsList = document.getElementById('searchResults');
    const resetButton = document.getElementById('resetButton');
    const locateMeButton = document.getElementById('locateMeButton');
    const startPointDisplay = document.getElementById('startPointDisplay');
    const endPointDisplay = document.getElementById('endPointDisplay');
    const routeInfo = document.getElementById('routeInfo');
    const facilityTypeSelectorContainer = document.getElementById('facility-type-selector-container');
    const facilityTypeSelector = document.getElementById('facility-type-selector');
    const adminControlsContainer = document.getElementById('admin-controls');
    const exportNodesButton = document.getElementById('exportNodesButton');
    const exportEdgesButton = document.getElementById('exportEdgesButton');
    const adminFeedback = document.getElementById('adminFeedback');

    const indoorMapView = document.getElementById('indoor-map-view');
    const indoorMapContainer = document.getElementById('indoor-map-container');
    const indoorBuildingName = document.getElementById('indoor-building-name');
    const indoorMapCloseButton = document.getElementById('indoor-map-close');
    const indoorMapImage = document.getElementById('indoor-map-image');
    const indoorMapImageContainer = document.getElementById('indoor-map-image-container');
    const indoorFloorSelector = document.getElementById('indoor-floor-selector');
    const indoorPathOverlay = document.getElementById('indoor-path-overlay');

    const controlsPanel = document.getElementById('controls');
    const controlsTitle = controlsPanel ? controlsPanel.querySelector('h1') : null;
    const toggleIndicator = controlsTitle ? controlsTitle.querySelector('.toggle-indicator') : null;

    const walkingSpeedMps = 1.3;
    const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };

    const HANGUL_START_CHAR_CODE = '가'.charCodeAt(0); const HANGUL_END_CHAR_CODE = '힣'.charCodeAt(0); const CHOSEONG_LIST = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']; const JAMO_START_CHAR_CODE = 'ㄱ'.charCodeAt(0); const JAMO_END_CHAR_CODE = 'ㅎ'.charCodeAt(0); function getChoseong(str) { if (!str) return ""; let r = ""; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); if (c >= HANGUL_START_CHAR_CODE && c <= HANGUL_END_CHAR_CODE) { r += CHOSEONG_LIST[Math.floor((c - HANGUL_START_CHAR_CODE) / 588)]; } else { r += str[i]; } } return r; } function isChoseongQuery(str) { if (!str) return false; const cs = str.replace(/\s+/g, ''); if (!cs) return false; for (let i = 0; i < cs.length; i++) { const c = cs[i]; const cc = c.charCodeAt(0); if (!CHOSEONG_LIST.includes(c) && (cc >= HANGUL_START_CHAR_CODE && cc <= HANGUL_END_CHAR_CODE)) { return false; } if (cc >= JAMO_START_CHAR_CODE && cc <= JAMO_END_CHAR_CODE && !CHOSEONG_LIST.includes(c)) { return false; } } return true; }

    function createFacilityIcon(color = 'gray') {
        let validColor = 'gray';
        if (typeof color === 'string' && color.trim() !== '') {
            const tester = new Option().style;
            tester.color = color;
            if (tester.color !== '') {
                validColor = color;
            } else {
                console.warn(`Invalid facility color specified: "${color}". Using default.`);
            }
        }
        const s = `background-color:${validColor};width:1.5rem;height:1.5rem;display:block;left:-0.75rem;top:-0.75rem;position:relative;border-radius:1.5rem 1.5rem 0;transform:rotate(45deg);border:1px solid #FFFFFF; box-shadow: 1px 1px 2px rgba(0,0,0,0.4);`;
        return L.divIcon({
            className: "facility-icon",
            iconAnchor: [0, 12],
            labelAnchor: [-3, -3],
            popupAnchor: [0, -15],
            html: `<span style="${s}"></span>`
        });
    }

    function resolveCoords(item, itemType) { if (item.lat != null && item.lng != null && !isNaN(item.lat) && !isNaN(item.lng)) { return [item.lat, item.lng]; } if (item.buildingId) { const b = buildingsData.find(bd => bd.id === item.buildingId); if (b && b.lat != null && b.lng != null && !isNaN(b.lat) && !isNaN(b.lng)) { return [b.lat, b.lng]; } } if (itemType === 'building' && item.lat != null && item.lng != null && !isNaN(item.lat) && !isNaN(item.lng)) { return [item.lat, item.lng]; } return null; }

    function buildGraph() {
        console.log("Rebuilding directed graph with attributes...");
        const graph = {};
        if (!pathNodesData || !pathEdgesData) {
            console.error("Graph build failed: Node or Edge data missing.");
            return graph;
        }
        pathNodesData.forEach(node => {
            graph[node.id] = [];
        });
        pathEdgesData.forEach(edge => {
            const startNodeExists = pathNodesData.some(n => n.id === edge.start);
            const endNodeExists = pathNodesData.some(n => n.id === edge.end);
            if (!startNodeExists || !endNodeExists || typeof edge.time !== 'number' || edge.time < 0 || !edge.start || !edge.end) {
                console.warn(`Skipping invalid edge or edge with missing node: Start=${edge.start}, End=${edge.end}, ID=${edge.id || 'N/A'}`);
                return;
            }
            if (!edge.surface) edge.surface = 'unknown';
            if (!edge.incline) edge.incline = 'flat';
            if (edge.stairs === undefined) edge.stairs = false;
            if (edge.wheelchair_accessible === undefined) edge.wheelchair_accessible = false;
            if (!graph[edge.start]) {
                console.warn(`Node ${edge.start} from edge ${edge.id || edge.start + '->' + edge.end} not found in initial node list? Adding.`);
                graph[edge.start] = [];
            }
            graph[edge.start].push({
                node: edge.end,
                edgeData: edge
            });
        });
        console.log(`Directed graph rebuilt: ${Object.keys(graph).length} nodes.`);
        return graph;
    }

    function initializeSearchData() {
        console.log("Initializing search data...");
        searchableData = [];
        availableFacilityTypes.clear();
        if (!buildingsData || !classroomsData || !facilitiesData) {
            console.error("Data arrays missing during search init!");
            return;
        }
        // Process Buildings
        buildingsData.forEach(b => {
            const c = resolveCoords(b, 'building');
            const nicknames = b.nicknames || []; // Get nicknames, default to empty array
            const displayText = b.name + (b.code ? ` (${b.code})` : '');
            // Include name and nicknames for Choseong calculation
            const choseongSourceText = [b.name, ...nicknames].join(" ");
            const choseongName = getChoseong(choseongSourceText);
            searchableData.push({
                id: b.id,
                type: 'building',
                name: b.name,
                code: b.code,
                nicknames: nicknames, // Add nicknames field
                lat: c ? c[0] : null,
                lng: c ? c[1] : null,
                displayText: displayText, // Keep original display text
                choseongName: choseongName, // Use combined Choseong
                original: b
            });
        });
        // Process Classrooms (unchanged logic, but depends on updated building data if needed)
        classroomsData.forEach(cr => {
            const b = buildingsData.find(bld => bld.id === cr.buildingId);
            if (b) {
                const c = resolveCoords(cr, 'classroom');
                const cc = b.code && cr.room ? `${b.code}${cr.room}` : null;
                const dn = cr.fullName || `${b.name} ${cr.floor || '?'}층 ${cr.room || '?'}호`;
                const dt = `${dn}` + (cc ? ` [${cc}]` : '');
                // Choseong for classrooms primarily uses its own name/building name
                const choseongName = getChoseong(dn);
                searchableData.push({
                    id: cr.id,
                    type: 'classroom',
                    name: dn,
                    classroomCode: cc,
                    buildingId: cr.buildingId,
                    buildingName: b.name,
                    floor: cr.floor,
                    room: cr.room,
                    lat: c ? c[0] : null,
                    lng: c ? c[1] : null,
                    displayText: dt,
                    choseongName: choseongName,
                    original: cr
                });
            }
        });
        // Process Facilities (unchanged logic)
        facilitiesData.forEach(f => {
            const c = resolveCoords(f, 'facility');
            const ft = f.type || 'default';
            const b = f.buildingId ? buildingsData.find(bld => bld.id === f.buildingId) : null;
            let dt = f.name;
            if (b) dt += ` (${b.name})`; else if (f.description) dt += ` (${f.description})`;
            const choseongName = getChoseong(f.name + " " + (f.description || '') + (b ? " " + b.name : ""));
            searchableData.push({
                id: f.id,
                type: 'facility',
                name: f.name,
                facilityType: ft,
                lat: c ? c[0] : null,
                lng: c ? c[1] : null,
                buildingId: f.buildingId,
                description: f.description,
                displayText: dt,
                choseongName: choseongName,
                original: f
            });
            if (c) availableFacilityTypes.add(ft);
        });

        // Update Fuse options to include the 'nicknames' field
        const fuseOptions = {
            includeScore: true,
            threshold: 0.4, // Adjust threshold if needed
            location: 0,
            distance: 100,
            maxPatternLength: 32,
            minMatchCharLength: 1,
            keys: [
                { name: 'name', weight: 0.4 },
                { name: 'displayText', weight: 0.3 },
                { name: 'nicknames', weight: 0.4 }, // ** ADDED NICKNAMES KEY **
                { name: 'classroomCode', weight: 0.5 },
                { name: 'code', weight: 0.4 },
                { name: 'facilityType', weight: 0.2 },
                { name: 'description', weight: 0.1 },
                { name: 'choseongName', weight: 0.3 } // Now includes Choseong of nicknames
            ]
        };

        if (searchableData.length > 0) {
            try {
                fuse = new Fuse(searchableData, fuseOptions);
                console.log(`Search data init ok. Fuse instance created with nickname support.`);
            } catch (error) {
                console.error("Error initializing Fuse.js:", error);
                fuse = null;
            }
        } else {
            console.error("Search data empty, Fuse not initialized.");
            fuse = null;
        }
    }

     function initializeFacilityLayers() {
         facilityCategoryLayers = {};
         searchableData
             .filter(item => item.type === 'facility' && item.lat != null)
             .forEach(item => {
                 const type = item.facilityType || 'default';
                 if (!facilityCategoryLayers[type]) {
                     facilityCategoryLayers[type] = L.layerGroup();
                 }
                 const itemColor = item.original.color;
                 const defaultColors = {
                     'restroom': 'dodgerblue', 'cafe': 'brown', 'atm': 'green',
                     'printer': 'darkgray', 'store': 'orange', 'vending_machine': 'purple',
                     'smoking_area': 'black', 'etc': 'gray'
                 };
                 const colorToUse = itemColor || defaultColors[type] || 'gray';
                 const icon = createFacilityIcon(colorToUse);
                 const popupText = `<b>${item.name}</b><br>${item.original.description || type || ''}`;
                 const marker = L.marker([item.lat, item.lng], {
                     icon: icon,
                     zIndexOffset: 750,
                     facilityId: item.id
                 });
                 marker.on('click', (e) => {
                     L.DomEvent.stopPropagation(e);
                     const pc = document.createElement('div');
                     pc.innerHTML = popupText;
                     const ad = document.createElement('div');
                     ad.style.cssText = 'margin-top: 8px; display: flex; flex-direction: column; gap: 5px;';
                     const sb = document.createElement('button'); sb.textContent = '출발'; sb.className='popup-button'; sb.onclick = () => { setRoutePoint(item, true); marker.closePopup(); };
                     const eb = document.createElement('button'); eb.textContent = '도착'; eb.className='popup-button'; eb.onclick = () => { setRoutePoint(item, false); marker.closePopup(); };
                     ad.appendChild(sb); ad.appendChild(eb); pc.appendChild(ad);
                     marker.bindPopup(pc).openPopup();
                 });
                 facilityCategoryLayers[type].addLayer(marker);
             });
         console.log("Facility layers initialized with dynamic icons.");
     }

     function createFacilityTypeSelectorUI() {
         if (!facilityTypeSelector) return;
         facilityTypeSelector.innerHTML = '';
         const facilityListContainer = document.getElementById('facilityListContainer');
         const facilityList = document.getElementById('facilityList');
         const facilityListTitle = document.getElementById('facilityListTitle');
         if (!facilityListContainer || !facilityList || !facilityListTitle) {
             console.error("Facility list UI elements not found!");
             return;
         }
         const sortedTypes = Array.from(availableFacilityTypes).sort();
         if (sortedTypes.length === 0) {
             facilityTypeSelector.innerHTML = '<p style="padding: 5px;">표시할 시설 타입 없음.</p>';
             facilityListContainer.style.display = 'none';
             return;
         }
         const typeDisplayNames = {
             'restroom':'화장실', 'cafe':'카페', 'atm':'ATM', 'printer':'프린터',
             'store':'편의점', 'vending_machine':'자판기', 'smoking_area':'흡연구역',
             'etc':'기타', 'default':'미분류'
         };
         sortedTypes.forEach(type => {
             const layerGroup = facilityCategoryLayers[type];
             if (layerGroup && layerGroup.getLayers().length > 0) {
                 const btn = document.createElement('button');
                 btn.textContent = typeDisplayNames[type] || type;
                 btn.className = 'facility-type-button';
                 btn.dataset.type = type;
                 btn.addEventListener('click', (e) => {
                     const clickedType = e.target.dataset.type;
                     const clickedLayerGroup = facilityCategoryLayers[clickedType];
                     const isActive = e.target.classList.contains('active');
                     facilityTypeSelector.querySelectorAll('.facility-type-button').forEach(b => {
                         if (b !== e.target) {
                              b.classList.remove('active');
                         }
                     });
                     if (currentlyDisplayedFacilityLayer && currentlyDisplayedFacilityLayer !== clickedLayerGroup) {
                         map.removeLayer(currentlyDisplayedFacilityLayer);
                     }
                      if (!isActive) {
                          e.target.classList.add('active');
                          if (clickedLayerGroup) {
                              map.addLayer(clickedLayerGroup);
                              currentlyDisplayedFacilityLayer = clickedLayerGroup;
                              currentlyDisplayedFacilityType = clickedType;
                              facilityList.innerHTML = '';
                              const facilitiesOfType = searchableData.filter(item =>
                                  item.type === 'facility' && item.facilityType === clickedType && item.lat != null
                              );
                              if (facilitiesOfType.length > 0) {
                                  facilitiesOfType.sort((a, b) => a.name.localeCompare(b.name));
                                  facilitiesOfType.forEach(facility => {
                                      const li = document.createElement('li');
                                      li.dataset.facilityId = facility.id;
                                      const itemColor = facility.original.color;
                                      const defaultColors = { 'restroom': 'dodgerblue', 'cafe': 'brown', 'atm': 'green', 'printer': 'darkgray', 'store': 'orange', 'vending_machine': 'purple', 'smoking_area': 'black', 'etc': 'gray' };
                                      const colorForIcon = itemColor || defaultColors[clickedType] || 'gray';
                                      li.innerHTML = `
                                          <span class="facility-list-icon" style="background-color: ${colorForIcon};"></span>
                                          <span class="facility-list-text" title="${facility.displayText || facility.name}">${facility.displayText || facility.name}</span>
                                      `;
                                      li.addEventListener('click', () => {
                                          let foundMarker = null;
                                          if (currentlyDisplayedFacilityLayer) {
                                              currentlyDisplayedFacilityLayer.eachLayer(marker => {
                                                  if (marker.options.facilityId === facility.id) {
                                                      foundMarker = marker;
                                                  }
                                              });
                                          }
                                          if (foundMarker) {
                                              map.panTo(foundMarker.getLatLng());
                                              foundMarker.openPopup();
                                              li.style.backgroundColor = 'var(--highlight-bg)';
                                              setTimeout(() => { li.style.backgroundColor = ''; }, 500);
                                          } else {
                                              console.warn(`Marker not found for facility ID: ${facility.id}`);
                                              panTo(facility.lat, facility.lng);
                                          }
                                      });
                                      facilityList.appendChild(li);
                                  });
                              } else {
                                  facilityList.innerHTML = '<li class="no-facilities">이 종류의 시설이 없습니다.</li>';
                              }
                              facilityListTitle.textContent = `${typeDisplayNames[clickedType] || clickedType} 목록`;
                              facilityListContainer.style.display = 'block';
                          } else {
                              currentlyDisplayedFacilityLayer = null;
                              currentlyDisplayedFacilityType = null;
                              facilityList.innerHTML = '';
                              facilityListContainer.style.display = 'none';
                          }
                      } else {
                          e.target.classList.remove('active');
                          if (currentlyDisplayedFacilityLayer) {
                              map.removeLayer(currentlyDisplayedFacilityLayer);
                          }
                          currentlyDisplayedFacilityLayer = null;
                          currentlyDisplayedFacilityType = null;
                          facilityList.innerHTML = '';
                          facilityListContainer.style.display = 'none';
                      }
                 });
                 facilityTypeSelector.appendChild(btn);
             }
         });
         console.log("Facility type UI created with list integration.");
     }

    function getNextNodeId() { let maxIdNum = 0; pathNodesData.forEach(node => { if (node.id && node.id.startsWith('N')) { try {const numPart = parseInt(node.id.substring(1), 10); if (!isNaN(numPart) && numPart > maxIdNum) maxIdNum = numPart;} catch(e){ console.warn("Error parsing node ID:", node.id)} } }); const newIdNum = maxIdNum + 1; return 'N' + String(newIdNum).padStart(3, '0'); }
    function findNearbyBuildings(lat, lng, radius = 100) { const nearby = []; if (!buildingsData || lat == null || lng == null) return nearby; buildingsData.forEach(building => { if (building.lat != null && building.lng != null) { const distance = haversineDistance({ lat, lng }, { lat: building.lat, lng: building.lng }); if (distance <= radius) { nearby.push({ id: building.id, name: building.name, code: building.code, distance: distance }); } } }); nearby.sort((a, b) => a.distance - b.distance); return nearby; }

    function openAddNodePopup(latlng) {
        if (!isAdminMode) return; map.closePopup(); const lat = latlng.lat; const lng = latlng.lng;
        const container = document.createElement('div'); container.style.minWidth = '250px';
        const title = document.createElement('h4'); title.textContent = '경로 노드 추가'; title.style.marginBottom = '10px'; title.style.textAlign = 'center'; container.appendChild(title);
        const typeContainer = document.createElement('div'); typeContainer.style.marginBottom = '12px'; typeContainer.style.display = 'flex'; typeContainer.style.justifyContent = 'space-around'; let selectedNodeType = 'outdoor';
        ['outdoor', 'entrance', 'indoor'].forEach(type => {
            const button = document.createElement('button'); const typeNames = { 'outdoor': '외부', 'entrance': '입구', 'indoor': '내부' }; button.textContent = typeNames[type]; button.dataset.type = type;
            button.style.cssText = "padding: 5px 10px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer;"; button.style.backgroundColor = (type === selectedNodeType) ? '#a0d0ff' : '#f0f0f0';
            button.addEventListener('click', () => { selectedNodeType = button.dataset.type; typeContainer.querySelectorAll('button').forEach(btn => { btn.style.backgroundColor = (btn.dataset.type === selectedNodeType) ? '#a0d0ff' : '#f0f0f0'; }); toggleBuildingFloorOptions(); });
            typeContainer.appendChild(button);
        });
        container.appendChild(typeContainer);
        const buildingFloorContainer = document.createElement('div'); buildingFloorContainer.id = 'node-building-floor-options'; buildingFloorContainer.style.display = 'none'; buildingFloorContainer.style.marginTop = '10px'; buildingFloorContainer.style.paddingTop = '10px'; buildingFloorContainer.style.borderTop = '1px solid #eee';
        const buildingSelectContainer = document.createElement('div'); buildingSelectContainer.style.marginBottom = '8px'; const buildingLabel = document.createElement('label'); buildingLabel.textContent = '건물: '; buildingLabel.style.marginRight = '5px'; const buildingSelect = document.createElement('select'); buildingSelect.id = 'node-building-select'; buildingSelect.style.minWidth = '150px'; buildingSelect.style.padding = '4px'; buildingSelectContainer.appendChild(buildingLabel); buildingSelectContainer.appendChild(buildingSelect); buildingFloorContainer.appendChild(buildingSelectContainer);
        const floorInputContainer = document.createElement('div'); floorInputContainer.id = 'node-floor-input-container'; floorInputContainer.style.display = 'none'; const floorLabel = document.createElement('label'); floorLabel.textContent = '층: '; floorLabel.style.marginRight = '5px';
        const floorInput = document.createElement('input'); floorInput.type = 'text'; floorInput.id = 'node-floor-input'; floorInput.placeholder = '숫자 또는 B1, B2 등'; floorInput.style.width = '100px'; floorInput.style.padding = '4px'; floorInputContainer.appendChild(floorLabel); floorInputContainer.appendChild(floorInput); buildingFloorContainer.appendChild(floorInputContainer); container.appendChild(buildingFloorContainer);
        const actionContainer = document.createElement('div'); actionContainer.style.marginTop = '15px'; actionContainer.style.display = 'flex'; actionContainer.style.justifyContent = 'flex-end'; actionContainer.style.gap = '8px';
        const confirmButton = document.createElement('button'); confirmButton.textContent = '추가'; confirmButton.className = 'popup-button'; confirmButton.style.cssText = "background-color: #d4edda; border-color: #c3e6cb; width: auto; display: inline-block;";
        confirmButton.addEventListener('click', () => {
            let buildingId = null, floor = null;
            if (selectedNodeType === 'entrance' || selectedNodeType === 'indoor') {
                buildingId = buildingSelect.value;
                if (!buildingId) { alert('입구 또는 내부 노드는 건물을 선택해야 합니다.'); return; }
            }
            if (selectedNodeType === 'indoor') {
                const floorVal = floorInput.value.trim().toUpperCase(); // Trim and convert B to uppercase
                if (floorVal === '') { alert('내부 노드는 층 번호를 입력해야 합니다.'); return; }
                const floorRegex = /^(B[1-9]\d*|[1-9]\d*)$/; // B followed by digits, or just digits (starting > 0)
                if (!floorRegex.test(floorVal)) { alert('층 형식 오류 (예: 1, 2, B1, B2)'); return; }
                floor = floorVal; // Store validated floor string (e.g., "1", "10", "B1")
            }
            createAndAddNode({ lat: lat, lng: lng, nodeType: selectedNodeType, buildingId: buildingId, floor: floor });
            map.closePopup();
        });
        const cancelButton = document.createElement('button'); cancelButton.textContent = '취소'; cancelButton.className = 'popup-button'; cancelButton.style.cssText = "background-color: #f8d7da; border-color: #f5c6cb; width: auto; display: inline-block;"; cancelButton.addEventListener('click', () => { map.closePopup(); });
        actionContainer.appendChild(cancelButton); actionContainer.appendChild(confirmButton); container.appendChild(actionContainer);
        function toggleBuildingFloorOptions() { const showBuilding = (selectedNodeType === 'entrance' || selectedNodeType === 'indoor'); const showFloor = (selectedNodeType === 'indoor'); buildingFloorContainer.style.display = showBuilding ? 'block' : 'none'; floorInputContainer.style.display = showFloor ? 'block' : 'none'; }
        const nearbyBuildings = findNearbyBuildings(lat, lng); buildingSelect.innerHTML = '<option value="">-- 건물 선택 --</option>';
        if (nearbyBuildings.length > 0) { nearbyBuildings.forEach(bldg => { const option = document.createElement('option'); option.value = bldg.id; option.textContent = `${bldg.name} (${bldg.code || bldg.id}) - ${bldg.distance.toFixed(0)}m`; buildingSelect.appendChild(option); }); } else { const option = document.createElement('option'); option.value = ''; option.textContent = '주변 건물 없음'; option.disabled = true; buildingSelect.appendChild(option); }
        L.popup({ closeButton: false, minWidth: 260 }).setLatLng(latlng).setContent(container).openOn(map);
    }

    function createAndAddNode(nodeDetails) { if (!isAdminMode || !nodeDetails) return; const { lat, lng, nodeType, buildingId, floor } = nodeDetails; const newId = getNextNodeId(); const newNode = { id: newId, lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)), nodeType: nodeType, buildingId: buildingId, floor: floor }; pathNodesData.push(newNode); if (!pathGraph[newId]) { pathGraph[newId] = []; } else { console.warn(`Node ID ${newId} already existed in graph structure? Overwriting.`); pathGraph[newId] = []; } addAdminNodeMarker(newNode); console.log(`Admin: Added node via popup: ${JSON.stringify(newNode)}`); let feedbackMsg = `노드 ${newNode.id} (${nodeType}${buildingId ? ` / ${buildingId}` : ''}${floor !== null ? ` / F${floor}` : ''}) 추가됨.`; showAdminFeedback(feedbackMsg); }
    function createAdminNodeIcon(nodeType = 'outdoor', isSelected = false) { let color = 'rgba(100, 100, 100, 0.7)'; if (nodeType === 'entrance') color = 'rgba(255, 165, 0, 0.7)'; else if (nodeType === 'indoor') color = 'rgba(66, 165, 245, 0.7)'; const baseSize = 8; const adminBaseSize = 11; const adminSelectedSize = 15; const size = isSelected ? adminSelectedSize : (isAdminMode ? adminBaseSize : baseSize); const borderStyle = isSelected ? '3px solid white' : '2px solid white'; const shadowStyle = isSelected ? '0 0 8px black' : '0 0 4px black'; const style = `background-color: ${color}; border-radius: 50%; border: ${borderStyle}; box-shadow: ${shadowStyle}; width: ${size}px; height: ${size}px;`; return L.divIcon({ className: 'admin-node-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<span style="${style}"></span>` }); }

    function addAdminNodeMarker(node) {
        if (!node || node.lat == null || node.lng == null) { console.warn("Skipping admin marker for node with missing coords:", node?.id); return; }
        const nodeType = node.nodeType || 'outdoor';
        const title = `ID: ${node.id}\nType: ${nodeType}${node.buildingId ? '\nBldg: ' + node.buildingId : ''}${node.floor !== null && node.floor !== undefined ? '\nFloor: ' + node.floor : ''}`;
        const markerOptions = { icon: createAdminNodeIcon(nodeType, false), title: title, nodeId: node.id, nodeData: node, draggable: isAdminMode };
        const marker = L.marker([node.lat, node.lng], markerOptions).addTo(adminNodeMarkersLayer);
        if (isAdminMode) { marker.on('click', handleAdminNodeClick); marker.on('dragend', handleNodeDragEnd); }
    }

    function handleNodeDragEnd(e) {
        if (!isAdminMode) return;
        const marker = e.target;
        const nodeId = marker.options.nodeId;
        const newLatLng = marker.getLatLng();
        const nodeIndex = pathNodesData.findIndex(n => n.id === nodeId);
        if (nodeIndex !== -1) {
            const oldLat = pathNodesData[nodeIndex].lat;
            const oldLng = pathNodesData[nodeIndex].lng;
            pathNodesData[nodeIndex].lat = parseFloat(newLatLng.lat.toFixed(6));
            pathNodesData[nodeIndex].lng = parseFloat(newLatLng.lng.toFixed(6));
            console.log(`Admin: Node ${nodeId} moved from [${oldLat}, ${oldLng}] to [${newLatLng.lat}, ${newLatLng.lng}]`);
            const connectedEdges = pathEdgesData.filter(edge => edge.start === nodeId || edge.end === nodeId);
            const affectedBaseIds = new Set();
            connectedEdges.forEach(edge => {
                const baseId = edge.id ? edge.id.replace(/_[FB]$/, '') : `${edge.start}-${edge.end}`;
                affectedBaseIds.add(baseId);
            });
            const layersToRemove = [];
            adminEdgeLayer.eachLayer(layer => {
                if (layer.options.edgeBaseId && affectedBaseIds.has(layer.options.edgeBaseId)) {
                    layersToRemove.push(layer);
                }
                else if (layer.options.edgeData && (layer.options.edgeData.start === nodeId || layer.options.edgeData.end === nodeId)) {
                     affectedBaseIds.add(layer.options.edgeBaseId || `${layer.options.edgeData.start}-${layer.options.edgeData.end}`);
                     layersToRemove.push(layer);
                }
            });
            layersToRemove.forEach(layer => adminEdgeLayer.removeLayer(layer));
            const edgesToAdd = pathEdgesData.filter(edge => {
                 const baseId = edge.id ? edge.id.replace(/_[FB]$/, '') : `${edge.start}-${edge.end}`;
                 return affectedBaseIds.has(baseId);
            });
            const addedBaseIds = new Set();
            edgesToAdd.forEach(edge => {
                 const baseId = edge.id ? edge.id.replace(/_[FB]$/, '') : `${edge.start}-${edge.end}`;
                 if (!addedBaseIds.has(baseId)) {
                      addAdminEdgeLine(edge, false);
                      addedBaseIds.add(baseId);
                 }
            });
            showAdminFeedback(`노드 ${nodeId} 위치 업데이트됨.`);
        } else {
            console.error(`handleNodeDragEnd: Could not find node data for ID ${nodeId}`);
            showAdminFeedback(`오류: 노드 ${nodeId} 데이터 찾기 실패`, true);
        }
    }

    function handleAdminNodeClick(e) {
        if (!isAdminMode) return; L.DomEvent.stopPropagation(e); const clickedMarker = e.target; const clickedNode = clickedMarker.options.nodeData;
        if (!clickedNode) { console.error("Node data missing from clicked marker!"); return; }
        const clickedNodeId = clickedNode.id; const nodeType = clickedNode.nodeType || 'outdoor';
        if (!firstNodeForEdge) {
            firstNodeForEdge = clickedNodeId; selectedMarkerForEdge = clickedMarker; clickedMarker.setIcon(createAdminNodeIcon(nodeType, true));
            showAdminFeedback(`노드 ${clickedNodeId} (${nodeType}) 선택됨. 다른 노드 클릭하여 엣지 생성 또는 팝업에서 삭제.`);
            const popupContent = document.createElement('div');
            let popupHtml = `<b>노드 ID: ${clickedNodeId}</b><br>타입: ${nodeType}`;
            if(clickedNode.buildingId) popupHtml += `<br>건물: ${clickedNode.buildingId}`;
            if(clickedNode.floor !== null && clickedNode.floor !== undefined) popupHtml += `<br>층: ${clickedNode.floor}`; // Shows B1, 1 etc.
            popupContent.innerHTML = popupHtml;
            const buttonContainer = document.createElement('div'); buttonContainer.style.marginTop = '8px';
            const deleteBtn = document.createElement('button'); deleteBtn.textContent = '이 노드 삭제'; deleteBtn.className = 'popup-button delete-button';
            deleteBtn.onclick = (evt) => { evt.stopPropagation(); executeNodeDelete(clickedNodeId, clickedMarker); map.closePopup(); };
            buttonContainer.appendChild(deleteBtn); popupContent.appendChild(buttonContainer);
            clickedMarker.bindPopup(popupContent, { closeButton: true, minWidth: 150 }).openPopup(); map.openPopup(clickedMarker.getPopup());
        } else {
            const secondNodeId = clickedNodeId;
            if (selectedMarkerForEdge && selectedMarkerForEdge.isPopupOpen()) { selectedMarkerForEdge.closePopup(); }
            if (clickedMarker.isPopupOpen()) { clickedMarker.closePopup(); }
            if (selectedMarkerForEdge) { const firstN = selectedMarkerForEdge.options.nodeData; if(firstN) selectedMarkerForEdge.setIcon(createAdminNodeIcon(firstN.nodeType || 'outdoor', false)); }
            if (firstNodeForEdge === secondNodeId) { showAdminFeedback("엣지 생성 취소 (같은 노드 선택됨)."); }
            else if (edgeExists(firstNodeForEdge, secondNodeId)) { showAdminFeedback(`엣지 ${firstNodeForEdge}-${secondNodeId} 이미 존재함 (적어도 한 방향).`); }
            else { createNewEdge(firstNodeForEdge, secondNodeId); }
            firstNodeForEdge = null; selectedMarkerForEdge = null;
        }
    }
    function getNextEdgeBaseId() { let maxIdNum = 0; pathEdgesData.forEach(edge => { if (edge.id && edge.id.startsWith('E')) { try { const numPartMatch = edge.id.match(/^E(\d+)/); if (numPartMatch && numPartMatch[1]) { const numPart = parseInt(numPartMatch[1], 10); if (!isNaN(numPart) && numPart > maxIdNum) { maxIdNum = numPart; } } } catch (e) { console.warn("Error parsing edge ID:", edge.id); } } }); const newIdNum = maxIdNum + 1; return 'E' + String(newIdNum).padStart(3, '0'); }
    function edgeExists(nodeId1, nodeId2) { return pathEdgesData.some(edge => (edge.start === nodeId1 && edge.end === nodeId2) || (edge.start === nodeId2 && edge.end === nodeId1)); }
    function createNewEdge(nodeId1, nodeId2) { if (!isAdminMode) return; const node1 = pathNodesData.find(n => n.id === nodeId1); const node2 = pathNodesData.find(n => n.id === nodeId2); if (!node1 || !node2 || node1.lat == null || node1.lng == null || node2.lat == null || node2.lng == null) { showAdminFeedback("엣지 생성 오류: 노드 좌표 없음.", true); console.error("Cannot create edge: Node data or coordinates missing."); return; } if (edgeExists(nodeId1, nodeId2)) { showAdminFeedback(`엣지 ${nodeId1}-${nodeId2} 이미 존재함 (적어도 한 방향).`, true); console.warn(`Edge creation skipped: An edge already exists between ${nodeId1} and ${nodeId2}.`); return; } const distance = haversineDistance(node1, node2); const time = Math.max(1, Math.round(distance / walkingSpeedMps)); const baseEdgeId = getNextEdgeBaseId(); const newEdgeForward = { id: `${baseEdgeId}_F`, start: nodeId1, end: nodeId2, time: time, surface: 'paved', incline: 'flat', stairs: false, wheelchair_accessible: true }; const newEdgeBackward = { id: `${baseEdgeId}_B`, start: nodeId2, end: nodeId1, time: time, surface: 'paved', incline: 'flat', stairs: false, wheelchair_accessible: true }; pathEdgesData.push(newEdgeForward); pathEdgesData.push(newEdgeBackward); if (!pathGraph[nodeId1]) pathGraph[nodeId1] = []; if (!pathGraph[nodeId2]) pathGraph[nodeId2] = []; pathGraph[nodeId1].push({ node: nodeId2, edgeData: newEdgeForward }); pathGraph[nodeId2].push({ node: nodeId1, edgeData: newEdgeBackward }); addAdminEdgeLine(newEdgeForward, true); showAdminFeedback(`양방향 엣지 ${nodeId1}↔${nodeId2} 추가됨 (ID: ${baseEdgeId}, 시간: ${time}초).`); console.log(`Admin: Added new edge pair: ${baseEdgeId}`); console.log("Forward:", JSON.stringify(newEdgeForward)); console.log("Backward:", JSON.stringify(newEdgeBackward)); }

    function addAdminEdgeLine(edge, isNew) {
        const node1 = pathNodesData.find(n => n.id === edge.start);
        const node2 = pathNodesData.find(n => n.id === edge.end);
        if (!node1 || !node2 || node1.lat == null || node1.lng == null || node2.lat == null || node2.lng == null) {
            console.warn(`Skipping edge line: Missing node data or coords for edge ID ${edge.id || `${edge.start}->${edge.end}`}`);
            return;
        }
        let baseId = edge.id ? edge.id.replace(/_[FB]$/, '') : `${edge.start}-${edge.end}`;
        let linesExist = false;
        adminEdgeLayer.eachLayer(layer => {
            if (layer.options.edgeBaseId === baseId) linesExist = true;
        });
        if (linesExist && !isNew) return;
        if (linesExist && isNew) console.warn(`Trying to add a new line for ${baseId}, but one visually exists.`);
        let color = isNew ? 'orange' : '#555';
        let weight = isNew ? 4 : 3;
        let dashArray = null;
        let lineClass = 'admin-edge-line';
        if (edge.surface === 'dirt' || edge.surface === 'grass') {
            color = isNew ? '#d9a64a' : '#a67c52'; dashArray = '5, 5'; weight = isNew ? 5 : 4;
        } else if (edge.surface === 'gravel') {
            color = isNew ? '#b0a090' : '#8c7b6a'; dashArray = '2, 4';
        } else if (edge.surface === 'indoor') {
             color = isNew ? '#a3c7ff' : '#8aa8d9'; dashArray = '4, 4'; weight = isNew ? 4 : 3;
        }
        if (edge.stairs) {
            color = isNew ? '#ff4500' : '#cc3700'; weight = isNew ? 6 : 5; dashArray = '1, 5';
        }
        if (edge.incline === 'steep') {
             weight += 1;
        }
        if (!edge.wheelchair_accessible) {
            weight = Math.max(2, weight - 1);
            if (!dashArray) dashArray = '1, 3';
            color = isNew ? '#aaa' : '#888';
            lineClass += ' wheelchair-inaccessible';
        }
        const nodeType1 = node1.nodeType || 'outdoor';
        const nodeType2 = node2.nodeType || 'outdoor';
        if ((nodeType1 === 'entrance' || nodeType2 === 'entrance') && edge.wheelchair_accessible) {
             color = isNew ? '#ffb74d' : '#cca370';
        }
        const commonOptions = { edgeData: edge, edgeBaseId: baseId };
        const visibleLineOptions = {
            ...commonOptions, weight: weight, color: color, opacity: isNew ? 0.9 : 0.7,
            dashArray: dashArray, className: lineClass
        };
        const hitAreaWeight = 20;
        const hitAreaOptions = { ...commonOptions, weight: hitAreaWeight, opacity: 0.0, interactive: true, className: 'admin-edge-hit-area' };
        try {
            const visibleLine = L.polyline([[node1.lat, node1.lng], [node2.lat, node2.lng]], visibleLineOptions).addTo(adminEdgeLayer);
            visibleLine.on('click', handleEdgeClick);
            const hitAreaLine = L.polyline([[node1.lat, node1.lng], [node2.lat, node2.lng]], hitAreaOptions).addTo(adminEdgeLayer);
            hitAreaLine.on('click', handleEdgeClick);
        } catch (error) {
            console.error(`Error creating polyline pair for edge ${edge.id}:`, error);
        }
    }


    function handleEdgeClick(e) {
        if (!isAdminMode) return;
        L.DomEvent.stopPropagation(e);
        const clickedLine = e.target;
        const edgeBaseId = clickedLine.options.edgeBaseId;
        const specificEdgeData = clickedLine.options.edgeData;
        if (!edgeBaseId || !specificEdgeData) {
            console.error("Edge base ID or specific data not found on clicked line.");
            showAdminFeedback("엣지 정보 오류", true); return;
        }
        const edgePair = pathEdgesData.filter(edge => {
            const currentBaseId = edge.id ? edge.id.replace(/_[FB]$/, '') : null;
            if (currentBaseId && currentBaseId === edgeBaseId) return true;
            return (edge.start === specificEdgeData.start && edge.end === specificEdgeData.end) ||
                   (edge.start === specificEdgeData.end && edge.end === specificEdgeData.start);
        });
        if (edgePair.length === 0) {
             console.error(`Could not find edge data for Base ID ${edgeBaseId} or nodes ${specificEdgeData.start}-${specificEdgeData.end}`);
             showAdminFeedback(`데이터에서 엣지 ${specificEdgeData.start}↔${specificEdgeData.end} 찾기 실패`, true);
             return;
        }
        const primaryEdge = edgePair.find(edge => edge.id === specificEdgeData.id) || edgePair[0];
        const startId = primaryEdge.start;
        const endId = primaryEdge.end;
        const container = document.createElement('div');
        container.style.minWidth = '280px';
        container.innerHTML = `<h4>엣지 수정 (${startId} ↔ ${endId})</h4>`;
        const form = document.createElement('form');
        form.style.marginTop = '10px';
        form.addEventListener('submit', (ev) => ev.preventDefault());
        form.innerHTML += `
            <div style="margin-bottom: 8px;">
                <label for="edge-time" style="display: block; margin-bottom: 3px; font-weight: bold;">시간 (초):</label>
                <input type="number" id="edge-time" name="time" value="${primaryEdge.time || 0}" min="0" step="1" required style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
        `;
        const surfaces = ['paved', 'dirt', 'grass', 'gravel', 'indoor', 'unknown'];
        const surfaceKoreanMap = {
            paved: '포장', dirt: '흙길', grass: '잔디', gravel: '자갈', indoor: '실내', unknown: '알수없음'
        };
        let surfaceOptions = surfaces.map(sKey =>
            `<option value="${sKey}" ${primaryEdge.surface === sKey ? 'selected' : ''}>${surfaceKoreanMap[sKey]}</option>`
        ).join('');
        form.innerHTML += `
            <div style="margin-bottom: 8px;">
                <label for="edge-surface" style="display: block; margin-bottom: 3px; font-weight: bold;">표면:</label>
                <select id="edge-surface" name="surface" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">${surfaceOptions}</select>
            </div>
        `;
        const inclines = ['flat', 'gentle', 'steep'];
        const inclineKoreanMap = {
            flat: '평지', gentle: '완만', steep: '가파름'
        };
        let currentInclineKey = 'flat';
        if (['uphill', 'downhill', 'gentle'].includes(primaryEdge.incline)) {
            currentInclineKey = 'gentle';
        } else if (['steep_up', 'steep_down', 'steep'].includes(primaryEdge.incline)) {
            currentInclineKey = 'steep';
        } else if (primaryEdge.incline === 'flat') {
             currentInclineKey = 'flat';
        }
        let inclineOptions = inclines.map(incKey =>
            `<option value="${incKey}" ${currentInclineKey === incKey ? 'selected' : ''}>${inclineKoreanMap[incKey]}</option>`
        ).join('');
         form.innerHTML += `
            <div style="margin-bottom: 8px;">
                <label for="edge-incline" style="display: block; margin-bottom: 3px; font-weight: bold;">경사:</label>
                <select id="edge-incline" name="incline" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">${inclineOptions}</select>
            </div>
        `;
        form.innerHTML += `
            <div style="margin-bottom: 10px;">
                <label style="display: flex; align-items: center;">
                    <input type="checkbox" id="edge-stairs" name="stairs" ${primaryEdge.stairs ? 'checked' : ''} style="margin-right: 5px;">
                    계단 포함
                </label>
            </div>
        `;
        form.innerHTML += `
            <div style="margin-bottom: 15px;">
                <label style="display: flex; align-items: center;">
                    <input type="checkbox" id="edge-wheelchair" name="wheelchair_accessible" ${primaryEdge.wheelchair_accessible ? 'checked' : ''} style="margin-right: 5px;">
                    휠체어 접근 가능
                </label>
            </div>
        `;
        container.appendChild(form);
        const actionContainer = document.createElement('div');
        actionContainer.style.marginTop = '15px';
        actionContainer.style.display = 'flex';
        actionContainer.style.justifyContent = 'space-between';
        actionContainer.style.gap = '8px';
        const saveButton = document.createElement('button');
        saveButton.textContent = '변경사항 저장';
        saveButton.className = 'popup-button';
        saveButton.style.backgroundColor = '#d4edda';
        saveButton.style.borderColor = '#c3e6cb';
        saveButton.onclick = () => {
            const newTime = parseInt(form.querySelector('#edge-time').value, 10);
            const newSurface = form.querySelector('#edge-surface').value;
            const newIncline = form.querySelector('#edge-incline').value;
            const newStairs = form.querySelector('#edge-stairs').checked;
            const newWheelchair = form.querySelector('#edge-wheelchair').checked;
            if (isNaN(newTime) || newTime < 0) {
                alert('유효한 시간(초)을 입력하세요.');
                return;
            }
            let updatedCount = 0;
            edgePair.forEach(edgeToUpdate => {
                const index = pathEdgesData.findIndex(edge => edge.id === edgeToUpdate.id);
                if (index !== -1) {
                     pathEdgesData[index].time = newTime;
                     pathEdgesData[index].surface = newSurface;
                     pathEdgesData[index].incline = newIncline;
                     pathEdgesData[index].stairs = newStairs;
                     pathEdgesData[index].wheelchair_accessible = newWheelchair;
                     updatedCount++;
                } else {
                     const fallbackIndex = pathEdgesData.findIndex(edge => edge.start === edgeToUpdate.start && edge.end === edgeToUpdate.end);
                     if (fallbackIndex !== -1) {
                        pathEdgesData[fallbackIndex].time = newTime;
                        pathEdgesData[fallbackIndex].surface = newSurface;
                        pathEdgesData[fallbackIndex].incline = newIncline;
                        pathEdgesData[fallbackIndex].stairs = newStairs;
                        pathEdgesData[fallbackIndex].wheelchair_accessible = newWheelchair;
                        updatedCount++;
                    }
                    else {console.warn(`Could not find edge ${edgeToUpdate.start}->${edgeToUpdate.end} in pathEdgesData during update.`);}
                }
            });
            if (updatedCount > 0) {
                pathGraph = buildGraph();
                const layersToRemove = [];
                adminEdgeLayer.eachLayer(layer => {
                    if (layer.options.edgeBaseId === edgeBaseId) layersToRemove.push(layer);
                });
                layersToRemove.forEach(layer => adminEdgeLayer.removeLayer(layer));
                const edgeToAddBack = pathEdgesData.find(edge => edge.id === primaryEdge.id) || pathEdgesData.find(edge => edge.start === startId && edge.end === endId);
                if (edgeToAddBack) {
                   addAdminEdgeLine(edgeToAddBack, false);
                } else {
                   console.error("Could not find edge to re-add visually after update.");
                }
                showAdminFeedback(`엣지 ${startId}↔${endId} 업데이트됨 (${updatedCount}개 방향).`);
                map.closePopup();
            } else {
                 showAdminFeedback(`오류: 엣지 ${startId}↔${endId} 업데이트 실패.`, true);
            }
        };
        actionContainer.appendChild(saveButton);
        const deleteButton = document.createElement('button');
        deleteButton.textContent = '이 엣지 쌍 삭제';
        deleteButton.className = 'popup-button delete-button';
        deleteButton.onclick = () => confirmEdgeDelete(edgeBaseId, startId, endId, clickedLine);
        actionContainer.appendChild(deleteButton);
        container.appendChild(actionContainer);
        L.popup({ minWidth: 280, closeButton: true })
         .setLatLng(e.latlng)
         .setContent(container)
         .openOn(map);
    }


    function confirmEdgeDelete(baseEdgeId, nodeId1, nodeId2, polylineLayer) { if (!isAdminMode) return; let removedCount = 0; const originalLength = pathEdgesData.length; pathEdgesData = pathEdgesData.filter(edge => { const isMatchById = edge.id && (edge.id === `${baseEdgeId}_F` || edge.id === `${baseEdgeId}_B`); const isMatchByNodes = (edge.start === nodeId1 && edge.end === nodeId2) || (edge.start === nodeId2 && edge.end === nodeId1); if (isMatchById || isMatchByNodes) { console.log(`Admin: Removing edge: ${JSON.stringify(edge)}`); removedCount++; return false; } return true; }); if (removedCount > 0) { if (adminEdgeLayer.hasLayer(polylineLayer)) { adminEdgeLayer.removeLayer(polylineLayer); } else { console.warn(`Could not find polyline layer with baseId ${baseEdgeId} to remove.`); adminEdgeLayer.eachLayer(layer => { if (layer.options.edgeBaseId === baseEdgeId) { adminEdgeLayer.removeLayer(layer); console.log("Removed polyline by searching baseId."); } }); } pathGraph = buildGraph(); showAdminFeedback(`엣지 ${nodeId1}↔${nodeId2} (${removedCount}개 방향) 삭제됨.`); console.log(`Admin: Removed ${removedCount} edge directions between ${nodeId1} and ${nodeId2}.`); } else { showAdminFeedback(`삭제 오류: 엣지 ${nodeId1}↔${nodeId2} (Base ID: ${baseEdgeId}) 를 데이터에서 찾을 수 없습니다.`, true); console.error(`Could not find edges to delete for base ID ${baseEdgeId} or nodes ${nodeId1}-${nodeId2}`); } map.closePopup(); }
    function executeNodeDelete(nodeId, marker) { if (!isAdminMode) return; const nodeIndex = pathNodesData.findIndex(node => node.id === nodeId); if (nodeIndex === -1) { showAdminFeedback(`삭제 오류: 노드 ${nodeId} 를 데이터에서 찾을 수 없습니다.`, true); map.closePopup(); return; } const removedNode = pathNodesData.splice(nodeIndex, 1)[0]; console.log(`Admin: Removed node: ${JSON.stringify(removedNode)}`); const edgesToRemove = pathEdgesData.filter(edge => edge.start === nodeId || edge.end === nodeId); const removedEdgeCount = edgesToRemove.length; pathEdgesData = pathEdgesData.filter(edge => edge.start !== nodeId && edge.end !== nodeId); adminEdgeLayer.clearLayers(); pathEdgesData.forEach(edge => addAdminEdgeLine(edge, false)); if (adminNodeMarkersLayer.hasLayer(marker)) { adminNodeMarkersLayer.removeLayer(marker); } else { console.warn(`Could not find node marker ${nodeId} to remove.`); } pathGraph = buildGraph(); if (firstNodeForEdge === nodeId) { firstNodeForEdge = null; selectedMarkerForEdge = null; } showAdminFeedback(`노드 ${nodeId} 및 연결된 엣지 ${removedEdgeCount}개 방향 삭제됨.`); }
    function showAdminFeedback(message, isError = false) { if(adminFeedback){adminFeedback.textContent=message; adminFeedback.className = isError ? 'error' : ''; setTimeout(()=>{if(adminFeedback.textContent===message)adminFeedback.textContent='';},6000);} if(isError)console.error("Admin Error:",message); }
    function exportData(data, filename) { if(!isAdminMode)return; try { let dataToExport = data; if (filename.includes('pathNodes')) { dataToExport = data.map(node => ({ id: node.id, lat: node.lat, lng: node.lng, nodeType: node.nodeType || 'outdoor', buildingId: node.buildingId || null, floor: node.floor !== undefined ? node.floor : null })); } else if (filename.includes('pathEdges')) { dataToExport = data.map(edge => ({ id: edge.id || `${edge.start}_${edge.end}`, start: edge.start, end: edge.end, time: edge.time, surface: edge.surface || 'unknown', incline: edge.incline || 'flat', stairs: edge.stairs || false, wheelchair_accessible: edge.wheelchair_accessible || false })); } const jsonData=JSON.stringify(dataToExport, null, 2); const blob=new Blob([jsonData],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); console.log(`Admin: Exported ${filename}.`); showAdminFeedback(`${filename} 다운로드 완료.`); } catch(error){ showAdminFeedback(`내보내기 오류: ${error.message}`,true); console.error(`Export error ${filename}:`,error); } }

    function handleContextMenu(e) {
        const lat = e.latlng.lat; const lng = e.latlng.lng; const latStr = lat.toFixed(6); const lngStr = lng.toFixed(6);
        const title = `위도: ${latStr}<br>경도: ${lngStr}`; const pc = document.createElement('div'); pc.innerHTML = title;
        const ad = document.createElement('div'); ad.style.cssText = 'margin-top: 8px; display: flex; flex-direction: column; gap: 5px;';
        const sb = document.createElement('button'); sb.textContent = '출발지로 설정'; sb.className = 'popup-button';
        sb.onclick = () => { const loc = { id: `custom_${latStr}_${lngStr}`, type: 'custom', name: `위치(${latStr.substring(0, 5)}...)`, lat: lat, lng: lng, displayText: `위치(${latStr}, ${lngStr})` }; setRoutePoint(loc, true); map.closePopup(); };
        const eb = document.createElement('button'); eb.textContent = '도착지로 설정'; eb.className = 'popup-button';
        eb.onclick = () => { const loc = { id: `custom_${latStr}_${lngStr}`, type: 'custom', name: `위치(${latStr.substring(0, 5)}...)`, lat: lat, lng: lng, displayText: `위치(${latStr}, ${lngStr})` }; setRoutePoint(loc, false); map.closePopup(); };
        ad.appendChild(sb); ad.appendChild(eb);
        if (isAdminMode) {
            const addNodeBtn = document.createElement('button'); addNodeBtn.textContent = '경로 노드 추가'; addNodeBtn.className = 'popup-button'; addNodeBtn.style.backgroundColor = '#c8e6c9';
            addNodeBtn.onclick = () => { openAddNodePopup(e.latlng); };
            ad.appendChild(addNodeBtn);
        }
        pc.appendChild(ad);
        L.popup({ minWidth: 180 }).setLatLng(e.latlng).setContent(pc).openOn(map);
    }

    function resetAll() {
        console.log("Resetting all...");
        if (locationWatchId !== null) { navigator.geolocation.clearWatch(locationWatchId); locationWatchId = null; console.log("Stopped location watching."); }
        if (userLocationMarker) { if (map.hasLayer(userLocationMarker)) map.removeLayer(userLocationMarker); if (routeLayer.hasLayer(userLocationMarker)) routeLayer.removeLayer(userLocationMarker); userLocationMarker = null; }
        clearTimeout(findRouteDebounceTimer); findRouteDebounceTimer = null;
        clearSearchMarkers(); routeLayer.clearLayers(); indoorSegmentMarkers.clearLayers(); hideIndoorMap();
        clearSearchResults(); searchInput.value = ''; startLocation = null; endLocation = null;
        startPointDisplay.textContent = '맵 우클릭 또는 검색 후 선택'; endPointDisplay.textContent = '맵 우클릭 또는 검색 후 선택';
        startPointDisplay.title = ''; endPointDisplay.title = '';
        startPointDisplay.style.fontStyle = 'italic'; startPointDisplay.style.color = 'var(--text-color-secondary)';
        endPointDisplay.style.fontStyle = 'italic'; endPointDisplay.style.color = 'var(--text-color-secondary)';
        updateRouteInfo('출발지와 도착지를 선택하세요.', 'info');
        const defaultPrefRadio = document.querySelector('input[name="routePref"][value="fastest"]');
        if (defaultPrefRadio) defaultPrefRadio.checked = true;
        currentUserPreference = 'fastest';
        if (currentlyDisplayedFacilityLayer) {
            map.removeLayer(currentlyDisplayedFacilityLayer);
            currentlyDisplayedFacilityLayer = null;
            currentlyDisplayedFacilityType = null;
        }
        facilityTypeSelector.querySelectorAll('.facility-type-button.active').forEach(btn => btn.classList.remove('active'));
        const facilityListContainer = document.getElementById('facilityListContainer');
        const facilityList = document.getElementById('facilityList');
        if (facilityListContainer) facilityListContainer.style.display = 'none';
        if (facilityList) facilityList.innerHTML = '';
        if (isAdminMode) { adminNodeMarkersLayer.clearLayers(); adminEdgeLayer.clearLayers(); pathNodesData.forEach(node => addAdminNodeMarker(node)); pathEdgesData.forEach(edge => addAdminEdgeLine(edge, false)); }
        firstNodeForEdge = null; selectedMarkerForEdge = null; if (adminFeedback) { adminFeedback.textContent = ''; adminFeedback.className = ''; } map.closePopup();
        if (schLocation) map.setView([schLocation.lat, schLocation.lng], 16);
        console.log("Reset complete.");
     }

     function updateRouteInfo(message, status = 'info') {
        if (!routeInfo) return;
        routeInfo.textContent = message;
        routeInfo.className = `status-${status}`;
     }

    function addRoutePointMarker(location, isStart) {
        if (!location || location.lat == null || location.lng == null) return null;
        if (isStart && location.id === 'userLocation') { console.log("Skipping standard start marker for user location."); if (userLocationMarker && !map.hasLayer(userLocationMarker) && !routeLayer.hasLayer(userLocationMarker)) { map.addLayer(userLocationMarker); } return userLocationMarker; }
        const url = isStart ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png' : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png';
        const sh = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png';
        const icon = L.icon({ iconUrl: url, shadowUrl: sh, iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
        const title = (isStart ? "출발: " : "도착: ") + (location.displayText || location.name);
        let existingMarker = null; routeLayer.eachLayer(l => { if (l !== userLocationMarker && l.options && l.options.isRouteMarker === true && l.options.isStart === isStart) { existingMarker = l; } }); if (existingMarker) { routeLayer.removeLayer(existingMarker); console.log(`Removed previous standard ${isStart ? 'start' : 'end'} marker.`); }
        const marker = L.marker([location.lat, location.lng], { icon: icon, isRouteMarker: true, isStart: isStart, zIndexOffset: 850 }).bindPopup(title);
        routeLayer.addLayer(marker); return marker;
    }

    function setRoutePoint(item, isStart) {
        let lat = item.lat; let lng = item.lng;
        if ((item.type === 'building' || item.type === 'classroom' || item.type === 'classroom-synthetic') && (lat == null || lng == null)) { const coords = resolveCoords(item.original || item, item.type); if (coords) { lat = coords[0]; lng = coords[1]; } console.log(`Resolved coords for ${item.name}: ${lat}, ${lng}`); }
        if (lat == null || lng == null) { alert(`선택한 장소 '${item.name}'의 좌표가 없어 ${isStart ? '출발지' : '도착지'}로 설정할 수 없습니다.`); updateRouteInfo(`'${item.name}' 좌표 없음`, 'error'); return; }
        const displayElement = isStart ? startPointDisplay : endPointDisplay; const locationName = item.displayText || item.name; const pointData = { ...item, lat: lat, lng: lng };
        if (isStart && pointData.id !== 'userLocation' && locationWatchId !== null) { console.log("Manual start point set, stopping location watching."); navigator.geolocation.clearWatch(locationWatchId); locationWatchId = null; if (userLocationMarker && map.hasLayer(userLocationMarker)) { userLocationMarker.unbindPopup().bindPopup("나의 현재 위치 (추적 중지됨)"); } updateRouteInfo("도착지를 선택하세요.", 'info'); }
        if (isStart) { startLocation = pointData; } else { endLocation = pointData; }
        displayElement.textContent = locationName; displayElement.title = locationName; displayElement.style.fontStyle = 'normal'; displayElement.style.color = 'var(--text-color-primary)';
        addRoutePointMarker(pointData, isStart);
        routeLayer.eachLayer(l => { if (l instanceof L.Polyline || l.options.isIndoorSegmentMarker) routeLayer.removeLayer(l); }); indoorSegmentMarkers.clearLayers();
        if (startLocation && startLocation.lat != null && endLocation && endLocation.lat != null) {
            console.log("Both start and end points set. Debouncing route finding...");
            const selectedPrefRadio = document.querySelector('input[name="routePref"]:checked');
            const currentPrefText = selectedPrefRadio ? selectedPrefRadio.parentElement.textContent.trim() : '최단 시간';
            updateRouteInfo(`경로 탐색 중 (${currentPrefText})...`, 'info');
            clearTimeout(findRouteDebounceTimer);
            findRouteDebounceTimer = setTimeout(() => { findRoute(); }, 50);
        } else {
             let message = '출발지와 도착지를 선택하세요.'; let status = 'info'; if (startLocation && !endLocation) { if (startLocation.id === 'userLocation' && locationWatchId !== null) { message = "나의 위치 추적 중. 도착지를 선택하세요."; } else { message = '도착지를 선택하세요.'; } } else if (!startLocation && endLocation) { message = '출발지를 선택하세요.'; }
             updateRouteInfo(message, status);
        }
    }

    function createSearchMarker(item, layerGroup) {
        if(item.lat==null||item.lng==null)return null;
        let icon = null;
        if (item.type === 'facility') {
            const itemColor = item.original.color;
            const defaultColors = { 'restroom': 'dodgerblue', 'cafe': 'brown', 'atm': 'green', 'printer': 'darkgray', 'store': 'orange', 'vending_machine': 'purple', 'smoking_area': 'black', 'etc': 'gray' };
            const colorToUse = itemColor || defaultColors[item.facilityType || 'default'] || 'gray';
            icon = createFacilityIcon(colorToUse);
        }
        const markerOptions={zIndexOffset: 800}; if(icon)markerOptions.icon=icon;
        const marker=L.marker([item.lat,item.lng],markerOptions); const pc=document.createElement('div'); pc.innerHTML=`<b>${item.displayText||item.name}</b>`; const ad=document.createElement('div'); ad.style.cssText='margin-top:8px;display:flex;flex-direction:column;gap:5px;'; const sb=document.createElement('button'); sb.textContent='출발'; sb.className='popup-button'; sb.onclick=()=>{setRoutePoint(item,true);marker.closePopup();}; const eb=document.createElement('button'); eb.textContent='도착'; eb.className='popup-button'; eb.onclick=()=>{setRoutePoint(item,false);marker.closePopup();}; ad.appendChild(sb); ad.appendChild(eb); pc.appendChild(ad); marker.bindPopup(pc); layerGroup.addLayer(marker); return marker;
    }


    function panTo(lat, lng) { if(lat!=null&&lng!=null) map.panTo([lat, lng]); }

    function clearSearchMarkers() { searchMarkers.clearLayers(); }
    function clearSearchResults() { searchResultsList.innerHTML = ''; }

    function displaySearchResults(term) {
        console.log(`--- displaySearchResults START --- Term: "${term}"`);
        clearSearchMarkers();
        clearSearchResults();
        const st = term.trim();
        if (!st) { searchResultsList.innerHTML = '<li style="padding: 10px; text-align: center; color: #888;">검색어를 입력하세요.</li>'; console.log("Search term empty."); return; }
        if (!fuse) { searchResultsList.innerHTML = '<li style="padding: 10px; text-align: center; color: #d9534f;">검색 엔진 오류</li>'; console.error("Fuse not ready!"); return; }

        let results = [];
        const added = new Set(); // Use a Set to track unique items already added

        // --- Synthetic Classroom Generation (No changes needed here) ---
        const createSyntheticResult = (building, roomNumber, patternType) => {
            const buildingCoords = resolveCoords(building, 'building');
            if (!building || !buildingCoords) {
                console.warn(`Cannot create synthetic result: Building invalid or no coords for ${building?.id}`);
                return null;
            }
            const syntheticId = `synthetic_${building.id}_${roomNumber}`;
            if (added.has(syntheticId)) return null; // Already added

            let inferredFloor = null;
            if (roomNumber.length >= 3) {
                const firstDigit = parseInt(roomNumber.charAt(0), 10);
                if (!isNaN(firstDigit) && firstDigit > 0) inferredFloor = firstDigit;
            }
            const floorText = inferredFloor ? `${inferredFloor}층 ` : '';
            const syntheticName = `${building.name} ${floorText}${roomNumber}호`;
            const syntheticResult = {
                id: syntheticId,
                type: 'classroom-synthetic',
                name: syntheticName,
                displayText: syntheticName,
                lat: buildingCoords[0],
                lng: buildingCoords[1],
                buildingId: building.id,
                buildingName: building.name,
                room: roomNumber,
                floor: inferredFloor,
                original: { ...building, synthetic: true, room: roomNumber, floor: inferredFloor }
            };
            console.log(`Added synthetic classroom result (${patternType}):`, syntheticResult);
            return { item: syntheticResult, score: 0.01 }; // Give synthetic results a slight penalty
        };

        let matchFoundBySpecificPattern = false;

        // --- Pattern Matching (No changes needed here) ---
        // 1. No-Space Pattern (e.g., H201)
        const noSpaceRegex = /^([A-Z0-9]+)(\d{3,4})$/i;
        const noSpaceMatch = st.match(noSpaceRegex);
        if (noSpaceMatch) {
            const buildingIdentifier = noSpaceMatch[1].toUpperCase();
            const roomNumber = noSpaceMatch[2];
            console.log(`No-Space pattern matched: Code='${buildingIdentifier}', Room='${roomNumber}'`);
            const building = buildingsData.find(b => b.code && b.code.toUpperCase() === buildingIdentifier);
            if (building) {
                // Check explicit classroom data first
                const explicitClassroom = classroomsData.find(cr => cr.buildingId === building.id && cr.room === roomNumber);
                if (explicitClassroom) {
                    const uid = 'classroom_' + explicitClassroom.id;
                    if (!added.has(uid)) {
                        const coords = resolveCoords(explicitClassroom, 'classroom');
                        const classroomItem = searchableData.find(sd => sd.type === 'classroom' && sd.id === explicitClassroom.id);
                        if (classroomItem && coords) {
                            console.log(`Found explicit classroom by No-Space pattern: ${classroomItem.displayText}`);
                            results.push({ item: { ...classroomItem, lat: coords[0], lng: coords[1] }, score: 0 }); // Best score for explicit match
                            added.add(uid);
                            matchFoundBySpecificPattern = true;
                        }
                    }
                } else {
                    // Create synthetic if no explicit match
                    const synthetic = createSyntheticResult(building, roomNumber, "No-Space");
                    if (synthetic) {
                        results.push(synthetic);
                        added.add(synthetic.item.id);
                        matchFoundBySpecificPattern = true;
                    }
                }
            } else { console.log(`Building code '${buildingIdentifier}' not found.`); }
        }

        // 2. Spaced Pattern (e.g., 인문관 201, H 201) - Only if No-Space didn't match
        if (!matchFoundBySpecificPattern) {
            const comboRegex = /^([A-Z0-9]+|[가-힣]+(?:\s[가-힣]+)*)\s+(\d{2,4})$/i;
            const comboMatch = st.match(comboRegex);
            if (comboMatch) {
                const buildingIdentifier = comboMatch[1].trim();
                const roomNumber = comboMatch[2];
                console.log(`Spaced pattern matched: Bldg='${buildingIdentifier}', Room='${roomNumber}'`);
                // Find building by code OR name OR nickname
                const building = buildingsData.find(b =>
                    (b.code && b.code.toUpperCase() === buildingIdentifier.toUpperCase()) ||
                    (b.name && b.name === buildingIdentifier) ||
                    (b.nicknames && b.nicknames.includes(buildingIdentifier)) // Check nicknames too
                );
                if (building) {
                    const explicitClassroom = classroomsData.find(cr => cr.buildingId === building.id && cr.room === roomNumber);
                    if (explicitClassroom) {
                        const uid = 'classroom_' + explicitClassroom.id;
                        if (!added.has(uid)) {
                             const coords = resolveCoords(explicitClassroom, 'classroom');
                             const classroomItem = searchableData.find(sd => sd.type === 'classroom' && sd.id === explicitClassroom.id);
                             if (classroomItem && coords) {
                                  console.log(`Found explicit classroom by Spaced pattern: ${classroomItem.displayText}`);
                                  results.push({ item: { ...classroomItem, lat: coords[0], lng: coords[1] }, score: 0 });
                                  added.add(uid);
                                  matchFoundBySpecificPattern = true;
                             }
                        }
                    } else {
                        const synthetic = createSyntheticResult(building, roomNumber, "Spaced");
                        if (synthetic) {
                             results.push(synthetic);
                             added.add(synthetic.item.id);
                             matchFoundBySpecificPattern = true;
                        }
                    }
                } else { console.log(`Building identifier '${buildingIdentifier}' not found.`); }
            }
        }

        // 3. Digit + Room Pattern (e.g., 9201 for 공학관 201) - Only if others didn't match
        if (!matchFoundBySpecificPattern) {
            const digitRoomRegex = /^([1-9])(\d{3,4})$/; // Building code is single digit 1-9
            const digitRoomMatch = st.match(digitRoomRegex);
            if (digitRoomMatch) {
                const buildingCodeDigit = digitRoomMatch[1];
                const roomNumber = digitRoomMatch[2];
                console.log(`Digit+Room pattern matched: CodeDigit='${buildingCodeDigit}', Room='${roomNumber}'`);
                const building = buildingsData.find(b => b.code === buildingCodeDigit);
                if (building) {
                    const explicitClassroom = classroomsData.find(cr => cr.buildingId === building.id && cr.room === roomNumber);
                    if (explicitClassroom) {
                        const uid = 'classroom_' + explicitClassroom.id;
                        if (!added.has(uid)) {
                             const coords = resolveCoords(explicitClassroom, 'classroom');
                             const classroomItem = searchableData.find(sd => sd.type === 'classroom' && sd.id === explicitClassroom.id);
                            if (classroomItem && coords) {
                                 console.log(`Found explicit classroom by Digit+Room pattern: ${classroomItem.displayText}`);
                                 // Slightly lower score than direct match
                                 results.push({ item: { ...classroomItem, lat: coords[0], lng: coords[1] }, score: 0.005 });
                                 added.add(uid);
                                 matchFoundBySpecificPattern = true;
                            }
                        }
                    } else {
                        console.log(`Building ${building.code} found, but explicit room ${roomNumber} not in data.`);
                        // Optionally create synthetic here too if desired
                        // const synthetic = createSyntheticResult(building, roomNumber, "Digit+Room");
                        // if (synthetic) { results.push(synthetic); added.add(synthetic.item.id); matchFoundBySpecificPattern = true; }
                    }
                } else { console.log(`Building with code '${buildingCodeDigit}' not found.`); }
            }
        }

        // --- Direct Code Matching (Building or Classroom Code) ---
        // Check if the input term directly matches a building code or classroom code (e.g., "ML", "9201")
        const up = st.toUpperCase().replace(/\s+/g, '');
        const isPotentialCode = /^[A-Z0-9]+$/i.test(st); // Check if it looks like a code
        if (isPotentialCode) {
            const directMatches = searchableData.filter(i =>
                (i.type === 'classroom' && i.classroomCode && i.classroomCode.toUpperCase() === up) ||
                (i.type === 'building' && i.code && i.code.toUpperCase() === up)
                // Add || (i.type === 'building' && i.nicknames && i.nicknames.map(n=>n.toUpperCase()).includes(up)) if you want direct nickname code match
            );

            directMatches.forEach(i => {
                const uid = i.type + "_" + i.id;
                // Avoid replacing a synthetic result if this is also a classroom result
                const syntheticEquivalentId = (i.type === 'classroom' || i.type === 'classroom-synthetic') ? `synthetic_${i.buildingId}_${i.room}` : null;

                if (!added.has(uid)) {
                     // If a synthetic version was added earlier, remove it in favor of the direct match
                     if (syntheticEquivalentId && added.has(syntheticEquivalentId)) {
                          results = results.filter(r => r.item.id !== syntheticEquivalentId);
                          added.delete(syntheticEquivalentId);
                          console.log(`Replacing synthetic result ${syntheticEquivalentId} with direct match ${uid}`);
                     }

                    const coords = resolveCoords(i.original || i, i.type);
                    if(coords) {
                         console.log(`Found direct code match: ${i.displayText} (${uid})`);
                         results.push({ item: { ...i, lat: coords[0], lng: coords[1] }, score: 0 }); // Best score
                         added.add(uid);
                    } else {
                         console.log(`Direct code match found for ${i.displayText} but has no coords.`);
                    }
                } else {
                    console.log(`Direct match ${uid} skipped (already added explicitly).`);
                }
            });
        }


        // --- Fallback to Fuse Search (Including Nicknames and Choseong) ---
        if (results.length === 0 && isChoseongQuery(st)) {
            console.log("Performing Choseong search...");
            const pt = st.toUpperCase().replace(/\s+/g, ''); // Use normalized query for Choseong match
            // Filter searchableData based on pre-calculated choseongName
            const cr = searchableData.filter(i => i.choseongName && i.choseongName.toUpperCase().includes(pt));
            cr.forEach(i => {
                const uid = i.type + "_" + i.id;
                if (!added.has(uid)) { // Ensure not already added by specific patterns
                     const coords = resolveCoords(i.original || i, i.type);
                     if(coords) {
                          results.push({ item: { ...i, lat: coords[0], lng: coords[1] }, score: 0.1 }); // Give Choseong matches a reasonable score
                          added.add(uid);
                     }
                }
            });
        }


        // If still no results from specific patterns or Choseong, use Fuse general search
        if (results.length === 0) {
             console.log("Performing Fuse search as fallback...");
            const fr = fuse.search(st);
            fr.forEach(r => {
                const i = r.item;
                const uid = i.type + "_" + i.id;
                if (r.score < 0.6 && !added.has(uid)) { // Use score threshold and check if not added
                    const coords = resolveCoords(i.original || i, i.type);
                     if (coords) {
                          // Add item with its Fuse score
                          results.push({ item: { ...i, lat: coords[0], lng: coords[1] }, score: r.score ?? 0.5 });
                          added.add(uid);
                     }
                }
            });
        }


        // Sort results by score (lower is better)
        results.sort((a, b) => a.score - b.score);

        // --- Display Logic (Mostly Unchanged) ---
        if (results.length === 0) {
            searchResultsList.innerHTML = '<li style="padding: 10px; text-align: center; color: #888;">검색 결과 없음</li>';
            console.log("No results found after all searches.");
            return;
        }

        const lim = 20; // Limit displayed results
        console.log(`Displaying top ${Math.min(results.length, lim)} results...`);

        results.slice(0, lim).forEach(r => {
            const i = r.item;
            try {
                const li = document.createElement('li');
                li.className = 'search-result-item';

                const ts = document.createElement('span');
                ts.className = 'result-text';
                ts.textContent = i.displayText || i.name; // Use pre-formatted display text
                ts.title = i.displayText || i.name; // Tooltip

                // Facility type display (unchanged)
                if (i.type === 'facility' && i.facilityType && i.facilityType !== 'default') {
                    const tys = document.createElement('span');
                    tys.className = 'facility-type';
                    const facilityNames = {'restroom':'화장실', 'cafe':'카페', 'atm':'ATM', 'printer':'프린터', 'store':'편의점', 'vending_machine':'자판기', 'smoking_area':'흡연구역', 'etc':'기타', 'default':'미분류'};
                    tys.textContent = ` [${facilityNames[i.facilityType] || i.facilityType}]`;
                    ts.appendChild(tys);
                }

                li.appendChild(ts);

                // Actions (Start/End buttons) if coordinates exist
                if (i.lat != null && i.lng != null) {
                    const ad = document.createElement('div');
                    ad.className = 'result-actions';
                    const sb = document.createElement('button'); sb.textContent = '출발'; sb.className = 'set-start';
                    sb.onclick = (e) => { e.stopPropagation(); setRoutePoint(i, true); panTo(i.lat, i.lng); };
                    const eb = document.createElement('button'); eb.textContent = '도착'; eb.className = 'set-end';
                    eb.onclick = (e) => { e.stopPropagation(); setRoutePoint(i, false); panTo(i.lat, i.lng); };
                    ad.appendChild(sb); ad.appendChild(eb);
                    li.appendChild(ad);
                    li.addEventListener('click', () => panTo(i.lat, i.lng));
                    li.style.cursor = 'pointer';
                    createSearchMarker(i, searchMarkers);
                } else {
                    li.className += ' no-coords';
                    ts.title += ' (좌표 없음)';
                    li.style.cursor = 'default';
                }
                searchResultsList.appendChild(li);
            } catch (error) {
                console.error("Error creating search result item:", error, "Item:", i);
            }
        });

        // More results indicator (unchanged)
        if (results.length > lim) {
            const li = document.createElement('li');
            li.textContent = `결과 ${results.length}개 중 ${lim}개 표시.`;
            li.style.cssText = 'font-style: italic; font-size: 0.8em; justify-content: center; color: #666; cursor: default; padding: 8px; text-align: center;';
            searchResultsList.appendChild(li);
        }

        // Fit map bounds (unchanged)
        if (searchMarkers && typeof searchMarkers.getLayers === 'function' && searchMarkers.getLayers().length > 0) {
            console.log(`Fitting bounds for ${searchMarkers.getLayers().length} markers.`);
            try {
                if (typeof searchMarkers.getBounds === 'function') {
                    const b = searchMarkers.getBounds();
                    if (b && b.isValid && b.isValid()) {
                        map.fitBounds(b.pad(0.1));
                        console.log("Bounds fitted.");
                    } else {
                        console.warn("Bounds object is invalid or method missing. Falling back to first marker.");
                        const firstMarker = searchMarkers.getLayers()[0];
                        if (firstMarker?.getLatLng) map.setView(firstMarker.getLatLng(), 17);
                    }
                } else {
                    console.error("!!! searchMarkers.getBounds is NOT a function !!!");
                     const firstMarker = searchMarkers.getLayers()[0];
                    if (firstMarker?.getLatLng) map.setView(firstMarker.getLatLng(), 17);
                }
            } catch (e) {
                console.error("Error fitting bounds:", e);
            }
        } else if (results.length > 0 && results[0].item.lat != null) {
            console.log("No markers found, panning to first result.");
            panTo(results[0].item.lat, results[0].item.lng);
        }
        console.log(`--- displaySearchResults END ---`);
    }

    function haversineDistance(coords1, coords2) { if(!coords1||coords1.lat==null||coords1.lng==null||!coords2||coords2.lat==null||coords2.lng==null)return Infinity; function R(x){return x*Math.PI/180;} const r=6371000; const dLat=R(coords2.lat-coords1.lat); const dLon=R(coords2.lng-coords1.lng); const lat1=R(coords1.lat); const lat2=R(coords2.lat); const a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.sin(dLon/2)*Math.sin(dLon/2)*Math.cos(lat1)*Math.cos(lat2); const c=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); return r*c; }
    function findNearestNode(lat, lng, allowedTypes = ['outdoor', 'entrance']) { if(lat==null||lng==null)return null; if(!pathNodesData||pathNodesData.length===0)return null; let nn=null, minDist=Infinity; pathNodesData.forEach(n=>{ if(n.lat==null || n.lng == null || !allowedTypes.includes(n.nodeType || 'outdoor')) return; const d=haversineDistance({lat,lng},{lat:n.lat,lng:n.lng}); if(d<minDist){minDist=d;nn=n;} }); return nn; }
    function getNodeData(nodeId) { return pathNodesData.find(node => node.id === nodeId); }
    function getBuildingEntrances(buildingId) { if (!buildingId || !pathNodesData) return []; return pathNodesData.filter(node => node.buildingId === buildingId && node.nodeType === 'entrance' && node.lat != null && node.lng != null ); }

    function calculatePreferencePenalty(edgeData, preference) {
        let penalty = 0;
        const PENALTY_HIGH = 10000;
        const PENALTY_MEDIUM = 200;
        const PENALTY_LOW = 50;
        switch (preference) {
            case 'no_stairs':
                if (edgeData.stairs) { penalty += PENALTY_HIGH; }
                break;
            case 'wheelchair':
                if (!edgeData.wheelchair_accessible || edgeData.stairs) {
                    penalty += PENALTY_HIGH;
                }
                if (edgeData.surface === 'dirt' || edgeData.surface === 'grass') {
                    penalty += PENALTY_MEDIUM;
                }
                if (edgeData.surface === 'gravel') {
                     penalty += PENALTY_MEDIUM;
                }
                if (edgeData.incline === 'steep') {
                    penalty += PENALTY_MEDIUM;
                } else if (edgeData.incline === 'gentle') {
                    penalty += PENALTY_LOW;
                }
                break;
            case 'no_dirt':
                if (edgeData.surface === 'dirt' || edgeData.surface === 'grass') {
                    penalty += PENALTY_HIGH;
                }
                if (edgeData.surface === 'gravel') {
                    penalty += PENALTY_MEDIUM;
                }
                break;
            case 'fastest':
            default:
                break;
        }
        if (preference !== 'fastest') {
            if (edgeData.surface !== 'paved' && edgeData.surface !== 'indoor') penalty += 0.1;
            if (edgeData.incline !== 'flat') penalty += 0.1;
        }
        return penalty;
    }


    function dijkstra(graph, startNodeId, endNodeId, preference = 'fastest') {
        console.log(`Running Dijkstra: ${startNodeId} -> ${endNodeId}, Preference: ${preference}`);
        if (!graph || !graph[startNodeId] || !graph[endNodeId]) { console.error(`Dijkstra Error: Graph invalid or start/end node missing. Start: ${startNodeId}, End: ${endNodeId}`); return { path: null, time: Infinity, cost: Infinity }; }
        const costs = {}; const times = {}; const prev = {}; const pq = new Map();
        Object.keys(graph).forEach(nodeId => { costs[nodeId] = Infinity; times[nodeId] = Infinity; prev[nodeId] = null; });
        costs[startNodeId] = 0; times[startNodeId] = 0; pq.set(startNodeId, 0);
        let iterations = 0; const maxIterations = Object.keys(graph).length * 20;
        while (pq.size > 0 && iterations < maxIterations) {
            iterations++;
            let currentId = null; let minCost = Infinity;
            for (const [nodeId, nodeCost] of pq.entries()) { if (nodeCost < minCost) { minCost = nodeCost; currentId = nodeId; } }
            if (currentId === null) { console.warn("Dijkstra break: No reachable node left in PQ."); break; }
            if (currentId === endNodeId) { console.log(`Dijkstra: Destination ${endNodeId} reached.`); break; }
            pq.delete(currentId);
            if (!graph[currentId] || !Array.isArray(graph[currentId])) { console.warn(`Dijkstra skip: Node ${currentId} has no valid neighbors in graph.`); continue; }
            graph[currentId].forEach(neighbor => {
                if (!neighbor || !neighbor.node || !neighbor.edgeData) { console.warn(`Skipping invalid neighbor data for node ${currentId}`); return; }
                const neighborId = neighbor.node; const edgeData = neighbor.edgeData;
                if (costs[neighborId] === undefined) { return; }
                const edgeTime = edgeData.time; const edgePenalty = calculatePreferencePenalty(edgeData, preference); const edgeCost = edgeTime + edgePenalty;
                const newTotalCost = costs[currentId] + edgeCost; const newTotalTime = times[currentId] + edgeTime;
                if (newTotalCost < costs[neighborId]) { costs[neighborId] = newTotalCost; times[neighborId] = newTotalTime; prev[neighborId] = currentId; pq.set(neighborId, newTotalCost); }
            });
        }
        if (iterations >= maxIterations) { console.error("Dijkstra Error: Max iterations reached. Possible graph issue or disconnected components."); return { path: null, time: Infinity, cost: Infinity }; }
        const path = []; let currentNodeId = endNodeId; const totalTime = times[endNodeId]; const totalCost = costs[endNodeId];
        if (totalCost === Infinity || (prev[endNodeId] === null && startNodeId !== endNodeId)) { console.warn(`Dijkstra Path Error: Target ${endNodeId} unreachable from ${startNodeId} with preference '${preference}'.`); return { path: null, time: Infinity, cost: Infinity }; }
        let pathIterations = 0; const maxPathIterations = Object.keys(graph).length + 5;
        while (currentNodeId !== null && pathIterations < maxPathIterations) { pathIterations++; path.unshift(currentNodeId); const previousNodeId = prev[currentNodeId]; if(currentNodeId === previousNodeId) { console.error(`Dijkstra Path Error: Cycle detected at node ${currentNodeId}.`); return {path:null, time:Infinity, cost: Infinity}; } currentNodeId = previousNodeId; }
        if (pathIterations >= maxPathIterations) { console.error("Dijkstra Path Error: Max iterations during path reconstruction."); return { path: null, time: Infinity, cost: Infinity }; }
        if (path.length > 0 && path[0] !== startNodeId) { console.error(`Dijkstra Path Error: Path does not start with start node (${path[0]} vs ${startNodeId}). Path: ${path}`); return { path: null, time: Infinity, cost: Infinity }; }
        if (path.length === 0 && startNodeId !== endNodeId) { console.error(`Dijkstra Path Error: Empty path generated for different start/end nodes.`); return { path: null, time: Infinity, cost: Infinity }; }
        else if (path.length === 0 && startNodeId === endNodeId) { return {path: [], time: 0, cost: 0 }; }
        console.log(`Dijkstra Result: Path length=${path.length}, Total Time=${totalTime.toFixed(1)}s, Total Cost=${totalCost.toFixed(1)}`);
        return { path, time: totalTime, cost: totalCost };
    }

    function findRoute() {
        console.log("--- findRoute START ---");
        routeLayer.eachLayer(l => { if (l instanceof L.Polyline || l.options.isIndoorSegmentMarker) routeLayer.removeLayer(l); });
        indoorSegmentMarkers.clearLayers();
        console.log("Route preference for this run:", currentUserPreference);
        if (!startLocation || startLocation.lat == null || !endLocation || endLocation.lat == null) { updateRouteInfo('오류: 출발/도착지 정보 부족', 'error'); console.error("findRoute error: Start or end location missing or invalid coords."); if(startLocation) addRoutePointMarker(startLocation, true); if(endLocation) addRoutePointMarker(endLocation, false); console.log("--- findRoute END (Error: Missing location) ---"); return; }
        let sameLoc = false;
        if (startLocation.id && endLocation.id && startLocation.id === endLocation.id) { sameLoc = true; }
        else if (startLocation.lat && endLocation.lat && startLocation.lat.toFixed(6) === endLocation.lat.toFixed(6) && startLocation.lng.toFixed(6) === endLocation.lng.toFixed(6)) { sameLoc = true; }
        if (sameLoc) { updateRouteInfo('출발지와 도착지가 같습니다.', 'success'); if (startLocation?.lat && startLocation.lng) map.setView([startLocation.lat, startLocation.lng], 17); addRoutePointMarker(startLocation, true); addRoutePointMarker(endLocation, false); console.log("--- findRoute END (Same location) ---"); return; }
        console.log(`Finding route from ${startLocation.name} (${startLocation.type}) to ${endLocation.name} (${endLocation.type})`);
        const prefRadio = document.querySelector(`input[name="routePref"][value="${currentUserPreference}"]`); const prefText = prefRadio ? prefRadio.parentElement.textContent.trim() : currentUserPreference; updateRouteInfo(`경로 탐색 중 (${prefText} 우선)...`, 'info');
        const isStartBuilding = startLocation.type === 'building' || startLocation.type === 'classroom' || startLocation.type === 'classroom-synthetic'; const isEndBuilding = endLocation.type === 'building' || endLocation.type === 'classroom' || endLocation.type === 'classroom-synthetic';
        const startBuildingId = isStartBuilding ? (startLocation.buildingId || startLocation.id) : null; const endBuildingId = isEndBuilding ? (endLocation.buildingId || endLocation.id) : null;
        let startEntrances = []; let endEntrances = [];
        if (isStartBuilding) { startEntrances = getBuildingEntrances(startBuildingId); if (startEntrances.length === 0) { updateRouteInfo(`경로 탐색 실패 (출발 건물 '${startLocation.name}' 입구 노드 없음)`, 'error'); console.error(`Routing Error: No 'entrance' nodes for start building ${startBuildingId}`); addRoutePointMarker(startLocation, true); addRoutePointMarker(endLocation, false); console.log("--- findRoute END (Error: No start entrance) ---"); return; } }
        if (isEndBuilding) { endEntrances = getBuildingEntrances(endBuildingId); if (endEntrances.length === 0) { updateRouteInfo(`경로 탐색 실패 (도착 건물 '${endLocation.name}' 입구 노드 없음)`, 'error'); console.error(`Routing Error: No 'entrance' nodes for end building ${endBuildingId}`); addRoutePointMarker(startLocation, true); addRoutePointMarker(endLocation, false); console.log("--- findRoute END (Error: No end entrance) ---"); return; } }
        let bestPath = null; let minCost = Infinity; let bestTime = Infinity; let bestStartNodeId = null; let bestEndNodeId = null;
        const startNode = isStartBuilding ? null : findNearestNode(startLocation.lat, startLocation.lng, ['outdoor', 'entrance']); const endNode = isEndBuilding ? null : findNearestNode(endLocation.lat, endLocation.lng, ['outdoor', 'entrance']);
         if (!isStartBuilding && !isEndBuilding) {
             if (!startNode || !endNode) { updateRouteInfo('경로 탐색 실패 (가까운 시작/끝 노드 찾기 실패)', 'error'); console.error(`Routing Error: Point-to-Point failed to find nearest nodes. Start: ${startNode?.id}, End: ${endNode?.id}`); bestPath = []; minCost = Infinity; bestTime = Infinity; }
             else if (startNode.id === endNode.id) { console.log("Nearest nodes are the same for Point-to-Point."); bestPath = [startNode.id]; const timeToNode = haversineDistance(startLocation, startNode) / walkingSpeedMps; const timeFromNode = haversineDistance(endNode, endLocation) / walkingSpeedMps; minCost = timeToNode + timeFromNode; bestTime = Math.max(1, Math.round(timeToNode + timeFromNode)); const directTime = Math.max(1, Math.round(haversineDistance(startLocation, endLocation) / walkingSpeedMps)); if (directTime < bestTime) { minCost = directTime; bestTime = directTime; bestPath = []; console.log("Direct P2P time shorter than via node."); } bestStartNodeId = startNode.id; bestEndNodeId = endNode.id; }
             else { const result = dijkstra(pathGraph, startNode.id, endNode.id, currentUserPreference); if (result.path && result.cost !== Infinity) { const timeToStartNode = haversineDistance(startLocation, startNode) / walkingSpeedMps; const timeFromEndNode = haversineDistance(endNode, endLocation) / walkingSpeedMps; const currentTotalTime = timeToStartNode + result.time + timeFromEndNode; const currentTotalCost = (timeToStartNode + timeFromEndNode) + result.cost; if (currentTotalCost < minCost) { minCost = currentTotalCost; bestTime = Math.max(1, Math.round(currentTotalTime)); bestPath = result.path; bestStartNodeId = startNode.id; bestEndNodeId = endNode.id; } } else { console.warn(`Dijkstra failed P2P: ${startNode.id} -> ${endNode.id}.`); bestPath = []; minCost = Infinity; bestTime = Infinity; } }
         } else if (isStartBuilding && !isEndBuilding) {
             if (!endNode) { updateRouteInfo('경로 탐색 실패 (도착 지점 가까운 노드 찾기 실패)', 'error'); console.error("Routing Error: B2P failed to find nearest end node."); minCost = Infinity; bestTime = Infinity; bestPath = []; }
             else { const timeFromEndNode = haversineDistance(endNode, endLocation) / walkingSpeedMps; startEntrances.forEach(sEntrance => { const result = dijkstra(pathGraph, sEntrance.id, endNode.id, currentUserPreference); if (result.path && result.cost !== Infinity) { const currentTotalTime = result.time + timeFromEndNode; const currentTotalCost = result.cost + timeFromEndNode; if (currentTotalCost < minCost) { minCost = currentTotalCost; bestTime = Math.max(1, Math.round(currentTotalTime)); bestPath = result.path; bestStartNodeId = sEntrance.id; bestEndNodeId = endNode.id; } } }); if (minCost === Infinity) console.warn(`B2P: No path found from any entrance of ${startBuildingId} to ${endNode.id} with preference '${currentUserPreference}'`); }
         } else if (!isStartBuilding && isEndBuilding) {
             if (!startNode) { updateRouteInfo('경로 탐색 실패 (출발 지점 가까운 노드 찾기 실패)', 'error'); console.error("Routing Error: P2B failed to find nearest start node."); minCost = Infinity; bestTime = Infinity; bestPath = []; }
             else { const timeToStartNode = haversineDistance(startLocation, startNode) / walkingSpeedMps; endEntrances.forEach(eEntrance => { const result = dijkstra(pathGraph, startNode.id, eEntrance.id, currentUserPreference); if (result.path && result.cost !== Infinity) { const currentTotalTime = timeToStartNode + result.time; const currentTotalCost = timeToStartNode + result.cost; if (currentTotalCost < minCost) { minCost = currentTotalCost; bestTime = Math.max(1, Math.round(currentTotalTime)); bestPath = result.path; bestStartNodeId = startNode.id; bestEndNodeId = eEntrance.id; } } }); if (minCost === Infinity) console.warn(`P2B: No path found from ${startNode.id} to any entrance of ${endBuildingId} with preference '${currentUserPreference}'`); }
         } else if (isStartBuilding && isEndBuilding) {
             startEntrances.forEach(sEntrance => { endEntrances.forEach(eEntrance => { if(sEntrance.id === eEntrance.id) { console.log(`Skipping B2B Dijkstra for same entrance node: ${sEntrance.id}`); return; } const result = dijkstra(pathGraph, sEntrance.id, eEntrance.id, currentUserPreference); if (result.path && result.cost !== Infinity) { const currentTotalTime = result.time; const currentTotalCost = result.cost; if (currentTotalCost < minCost) { minCost = currentTotalCost; bestTime = Math.max(1, Math.round(currentTotalTime)); bestPath = result.path; bestStartNodeId = sEntrance.id; bestEndNodeId = eEntrance.id; } } }); }); if (minCost === Infinity) console.warn(`B2B: No path found between any entrances of ${startBuildingId} and ${endBuildingId} with preference '${currentUserPreference}'`); }
         if (bestPath === null || minCost === Infinity) { updateRouteInfo('경로 탐색 실패 (경로 없음)', 'error'); addRoutePointMarker(startLocation, true); addRoutePointMarker(endLocation, false); console.error("Routing failed completely. No path found for the selected preference."); console.log("--- findRoute END (Error: No path found) ---"); }
         else { console.log("Calling drawPath with nodes:", bestPath || []); drawPath(bestPath || [], startLocation, endLocation, bestStartNodeId, bestEndNodeId); if (bestTime !== Infinity && bestTime >= 0) { const minutes = Math.max(1, Math.round(bestTime / 60)); const timeText = `약 ${minutes}분`; const trackingText = (startLocation?.id === 'userLocation' && locationWatchId !== null) ? " (실시간 추적 중)" : ""; let prefText = ""; const prefRadio = document.querySelector(`input[name="routePref"][value="${currentUserPreference}"]`); const prefLabel = prefRadio ? prefRadio.parentElement.textContent.trim() : currentUserPreference; if (currentUserPreference !== 'fastest') { prefText = ` (${prefLabel})`; } updateRouteInfo(`✅ 경로 찾음! ${timeText}${prefText}${trackingText}`, 'success'); console.log(`Best path found: StartNode=${bestStartNodeId}, EndNode=${bestEndNodeId}, Time=${bestTime.toFixed(0)}s, Cost=${minCost.toFixed(1)}. Path Nodes:`, bestPath); } else { updateRouteInfo('⚠️ 경로 시간 계산 불가', 'warning'); console.warn("Path calculation resulted in Infinity or invalid time, but a path object might exist."); } console.log("--- findRoute END (Success/Partial) ---"); }
    }

    function drawPath(pathNodeIds, startLoc, endLoc, startNodeId = null, endNodeId = null) {
        console.log("Drawing path with nodes:", pathNodeIds);
        routeLayer.eachLayer(l => { if (l instanceof L.Polyline || l.options.isIndoorSegmentMarker) routeLayer.removeLayer(l); });
        indoorSegmentMarkers.clearLayers();
        if (!startLoc || startLoc.lat == null || !endLoc || endLoc.lat == null) { console.error("drawPath error: Missing start or end coordinates."); addRoutePointMarker(startLoc, true); addRoutePointMarker(endLoc, false); return; }
        const startCoords = [startLoc.lat, startLoc.lng]; const endCoords = [endLoc.lat, endLoc.lng];
        const bounds = L.latLngBounds(); let boundsExtended = false;
        const startMarker = addRoutePointMarker(startLoc, true); const endMarker = addRoutePointMarker(endLoc, false);
        if(startMarker?.getLatLng) { bounds.extend(startMarker.getLatLng()); boundsExtended = true; }
        if(endMarker?.getLatLng) { bounds.extend(endMarker.getLatLng()); boundsExtended = true; }
        if (userLocationMarker && (map.hasLayer(userLocationMarker) || routeLayer.hasLayer(userLocationMarker))) { try { bounds.extend(userLocationMarker.getLatLng()); boundsExtended = true; } catch (e) { console.warn("Error extending bounds for user location marker:", e); } }
        let pathPoints = []; let indoorSegments = []; let lastDrawnNodeData = null;
        pathPoints.push(startCoords);
        const firstActualPathNode = pathNodeIds.length > 0 ? getNodeData(pathNodeIds[0]) : null; const startNearestNode = startNodeId ? getNodeData(startNodeId) : null;
        if (startNearestNode && firstActualPathNode && startNearestNode.id === firstActualPathNode.id) { if (startNearestNode.lat != null) { pathPoints.push([startNearestNode.lat, startNearestNode.lng]); lastDrawnNodeData = startNearestNode; } } else { lastDrawnNodeData = null; }
        let currentIndoorSegment = null;
        for (let i = 0; i < pathNodeIds.length; i++) {
            const nodeId = pathNodeIds[i]; const nodeData = getNodeData(nodeId);
            if (!nodeData || nodeData.lat == null || nodeData.lng == null) { console.warn(`Skipping node ${nodeId}: Data/coords missing.`); continue; }
            const currentNodeCoords = [nodeData.lat, nodeData.lng]; const currentNodeType = nodeData.nodeType || 'outdoor'; const lastNodeType = lastDrawnNodeData?.nodeType || 'outdoor';
            if (currentNodeType === 'entrance' && (lastNodeType === 'outdoor' || !lastDrawnNodeData)) { if (!lastDrawnNodeData && pathPoints.length === 1) { pathPoints.push(currentNodeCoords); } else if (lastDrawnNodeData && lastNodeType === 'outdoor') { pathPoints.push(currentNodeCoords); } if (pathPoints.length >= 2) { const segmentPolyline = L.polyline(pathPoints, { color: 'red', weight: 5, opacity: 0.8 }); segmentPolyline.addTo(routeLayer); if (segmentPolyline.getBounds()?.isValid()) { bounds.extend(segmentPolyline.getBounds()); boundsExtended = true; } else { bounds.extend(pathPoints); boundsExtended = true; } } currentIndoorSegment = { buildingId: nodeData.buildingId, entranceNode: nodeData, floors: new Set(nodeData.floor !== null ? [nodeData.floor] : []), nodes: [nodeData], exitNode: null }; indoorSegments.push(currentIndoorSegment); pathPoints = [currentNodeCoords]; }
            else if (currentNodeType === 'indoor') { if (currentIndoorSegment && currentIndoorSegment.buildingId === nodeData.buildingId) { if (nodeData.floor !== null) currentIndoorSegment.floors.add(nodeData.floor); currentIndoorSegment.nodes.push(nodeData); pathPoints = [currentNodeCoords]; } else { console.warn(`Indoor node ${nodeId} found without matching active indoor segment or wrong building.`); pathPoints.push(currentNodeCoords); currentIndoorSegment = null; } }
            else if (currentNodeType === 'entrance' && lastNodeType === 'indoor') { if (currentIndoorSegment && currentIndoorSegment.buildingId === nodeData.buildingId) { currentIndoorSegment.nodes.push(nodeData); currentIndoorSegment.exitNode = nodeData; pathPoints = [currentNodeCoords]; currentIndoorSegment = null; } else { console.warn(`Exit node ${nodeId} found without matching active indoor segment or wrong building.`); pathPoints.push(currentNodeCoords); currentIndoorSegment = null; } }
            else { if (!lastDrawnNodeData && pathPoints.length === 1) { pathPoints.push(currentNodeCoords); } else if (lastDrawnNodeData) { pathPoints.push(currentNodeCoords); } currentIndoorSegment = null; }
            lastDrawnNodeData = nodeData; bounds.extend(currentNodeCoords); boundsExtended = true;
        }
        const lastActualPathNode = lastDrawnNodeData; const endNearestNode = endNodeId ? getNodeData(endNodeId) : null;
        if (endNearestNode && lastActualPathNode && endNearestNode.id === lastActualPathNode.id) { pathPoints.push(endCoords); } else if (!endNearestNode && lastActualPathNode) { pathPoints.push(endCoords); } else if (pathNodeIds.length === 0) { if (pathPoints.length === 1 && pathPoints[0][0] === startCoords[0] && pathPoints[0][1] === startCoords[1]) { pathPoints.push(endCoords); } }
        if (pathPoints.length >= 2) { const firstP = pathPoints[0]; const lastP = pathPoints[pathPoints.length - 1]; if (firstP[0].toFixed(6) !== lastP[0].toFixed(6) || firstP[1].toFixed(6) !== lastP[1].toFixed(6)) { const finalPolyline = L.polyline(pathPoints, { color: 'red', weight: 5, opacity: 0.8 }); finalPolyline.addTo(routeLayer); if (finalPolyline.getBounds()?.isValid()) { bounds.extend(finalPolyline.getBounds()); boundsExtended = true; } else { bounds.extend(pathPoints); boundsExtended = true; } } else { console.log("Skipping final zero-length polyline segment."); } }
        indoorSegments.forEach(segment => { if (!segment.entranceNode?.lat || !segment.exitNode?.lat) { console.warn("Skipping indoor marker: Missing entrance/exit node.", segment); return; } const building = buildingsData.find(b => b.id === segment.buildingId); const buildingName = building?.name || segment.buildingId || 'Unknown Building'; const markerPosition = [segment.entranceNode.lat, segment.entranceNode.lng]; const entranceIcon = L.divIcon({ className: 'indoor-segment-marker', html: `<div style="background-color: #4CAF50; color: white; padding: 5px 8px; border-radius: 5px; font-size: 11px; white-space: nowrap; box-shadow: 1px 1px 3px rgba(0,0,0,0.4); cursor: pointer;">${buildingName} 내부 경로</div>`, iconSize: null, iconAnchor: [-10, 10] }); const marker = L.marker(markerPosition, { icon: entranceIcon, isIndoorSegmentMarker: true, zIndexOffset: 900 }); marker.on('click', () => { console.log("Clicked indoor segment marker for:", segment); showIndoorMap(segment); }); indoorSegmentMarkers.addLayer(marker); bounds.extend(markerPosition); boundsExtended = true; });
        if (indoorSegments.length > 0) { indoorSegmentMarkers.addTo(map); }
        if (boundsExtended && bounds.isValid()) { map.fitBounds(bounds.pad(0.15)); } else if (startLoc?.lat && endLoc?.lat) { console.warn("Could not determine valid bounds from route/markers. Fitting to start/end points."); map.fitBounds(L.latLngBounds(startCoords, endCoords).pad(0.15)); } else { console.warn("Could not determine valid bounds for fitting map view."); }
    }

    function startUserTrackingAndSetStart() { if (!navigator.geolocation) { alert("죄송합니다, 브라우저가 위치 정보 기능을 지원하지 않습니다."); updateRouteInfo('브라우저 미지원', 'error'); return; } console.log("Requesting user location to set as start and track..."); updateRouteInfo("내 위치 찾는 중...", 'info'); if (locationWatchId !== null) { navigator.geolocation.clearWatch(locationWatchId); locationWatchId = null; console.log("Stopped previous location watching."); } if (userLocationMarker) { if (map.hasLayer(userLocationMarker)) map.removeLayer(userLocationMarker); if (routeLayer.hasLayer(userLocationMarker)) routeLayer.removeLayer(userLocationMarker); userLocationMarker = null; } navigator.geolocation.getCurrentPosition( handleInitialPositionForTracking, handleLocationError, GEOLOCATION_OPTIONS ); }
    function handleInitialPositionForTracking(position) { const lat = position.coords.latitude; const lng = position.coords.longitude; const accuracy = position.coords.accuracy; console.log(`Initial location found: Lat: ${lat}, Lng: ${lng}, Accuracy: ${accuracy}m`); const userLoc = { id: 'userLocation', type: 'user', name: '나의 위치', lat: lat, lng: lng, displayText: `나의 위치` }; const userIcon = L.divIcon({ className: 'user-location-marker', iconSize: [16, 16], html: '' }); if (!userLocationMarker) { userLocationMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 950 }).addTo(map); } else { userLocationMarker.setLatLng([lat, lng]); } const popupContent = `<b>나의 현재 위치</b><br><span id="user-accuracy" style="font-size:0.9em; color:#555;">(정확도: ${Math.round(accuracy)}m)</span>`; userLocationMarker.bindPopup(popupContent, {offset: [0, -5]}).openPopup(); map.setView([lat, lng], 17); setRoutePoint(userLoc, true); console.log("Starting location watching..."); if (locationWatchId !== null) { navigator.geolocation.clearWatch(locationWatchId); } locationWatchId = navigator.geolocation.watchPosition(updatePosition, handleLocationError, GEOLOCATION_OPTIONS); if (locationWatchId === null || locationWatchId === undefined) { console.error("Failed to start location watching."); alert("실시간 위치 추적 시작에 실패했습니다."); if (startLocation && startLocation.id === 'userLocation') { updateRouteInfo("실시간 위치 추적 실패", 'error'); } } else { console.log("Location watching started with ID:", locationWatchId); } }
    function updatePosition(position) { const lat = position.coords.latitude; const lng = position.coords.longitude; const accuracy = position.coords.accuracy; if (!userLocationMarker) { console.warn("updatePosition called but userLocationMarker is missing. Stopping watch."); if (locationWatchId !== null) { navigator.geolocation.clearWatch(locationWatchId); locationWatchId = null; } return; } userLocationMarker.setLatLng([lat, lng]); const popup = userLocationMarker.getPopup(); if(popup) { popup.setContent(`<b>나의 현재 위치</b><br><span id="user-accuracy" style="font-size:0.9em; color:#555;">(정확도: ${Math.round(accuracy)}m)</span>`); } if (startLocation && startLocation.id === 'userLocation') { const movedSignificantly = !startLocation.lat || haversineDistance(startLocation, {lat, lng}) > 5; startLocation.lat = lat; startLocation.lng = lng; if (endLocation && endLocation.lat != null) { if (movedSignificantly) { console.log("User moved significantly. Debouncing route recalculation..."); const currentPrefRadio = document.querySelector('input[name="routePref"]:checked'); const currentPrefText = currentPrefRadio ? currentPrefRadio.parentElement.textContent.trim() : currentUserPreference; updateRouteInfo(`위치 변경 감지. 경로 재탐색 (${currentPrefText})...`, 'warning'); clearTimeout(findRouteDebounceTimer); findRouteDebounceTimer = setTimeout(() => { console.log("Debounce timer fired. Recalculating route..."); findRoute(); }, 1500); } } else { updateRouteInfo("나의 위치 추적 중. 도착지를 선택하세요.", 'info'); } } else if (locationWatchId !== null) { console.warn("Stopping stray location watch because user is not start point."); navigator.geolocation.clearWatch(locationWatchId); locationWatchId = null; updateRouteInfo("위치 추적 중단됨.", 'info'); } }
    function handleLocationError(error) { console.error("Geolocation error:", error); let message = "위치 정보를 가져오는 중 오류가 발생했습니다."; switch (error.code) { case error.PERMISSION_DENIED: message = "위치 정보 접근 권한이 거부되었습니다. 설정에서 허용해주세요."; break; case error.POSITION_UNAVAILABLE: message = "현재 위치 정보를 사용할 수 없습니다."; break; case error.TIMEOUT: message = "위치 정보 요청 시간이 초과되었습니다."; break; default: message = "알 수 없는 오류로 위치 정보를 가져올 수 없습니다."; break; } alert(message); if (locationWatchId !== null) { navigator.geolocation.clearWatch(locationWatchId); locationWatchId = null; console.log("Stopped location watching due to error."); if (startLocation && startLocation.id === 'userLocation') { startPointDisplay.textContent += " (추적 오류)"; updateRouteInfo("위치 추적 중단됨 (오류)", 'error'); } } else { updateRouteInfo("위치 찾기 오류", 'error'); } if (userLocationMarker) { const popupContent = `<b>나의 현재 위치</b><br><span style="color:red; font-weight:bold;">(위치 오류!)</span>`; userLocationMarker.bindPopup(popupContent, {offset: [0, -5]}).openPopup(); } }

    let currentIndoorSegmentData = null;

    function sortFloors(a, b) {
        const floorA = String(a); // Ensure strings
        const floorB = String(b);
        const isABasement = floorA.startsWith('B');
        const isBBasement = floorB.startsWith('B');

        if (isABasement && !isBBasement) return -1; // Basement floors first
        if (!isABasement && isBBasement) return 1;  // Ground/upper floors after basement

        if (isABasement && isBBasement) {
            // Both basement, sort descending numerically by absolute value (B2 before B1)
            const numA = parseInt(floorA.substring(1), 10);
            const numB = parseInt(floorB.substring(1), 10);
            return numB - numA; // Higher basement number (closer to ground) comes first
        } else {
            // Both ground/upper, sort ascending numerically
            const numA = parseInt(floorA, 10);
            const numB = parseInt(floorB, 10);
            return numA - numB;
        }
    }

    function showIndoorMap(segmentData) {
        console.log("Showing indoor map for:", segmentData);
        currentIndoorSegmentData = segmentData;
        const building = buildingsData.find(b => b.id === segmentData.buildingId);
        if (!building) { console.error(`Cannot show indoor map: Building data not found for ID ${segmentData.buildingId}`); alert(`건물 정보(${segmentData.buildingId})를 찾을 수 없습니다.`); return; }
        indoorBuildingName.textContent = building.name || segmentData.buildingId;
        indoorFloorSelector.innerHTML = '';
        let availableFloors = new Set();
        // Add floors from the path segment nodes
        segmentData.nodes.forEach(node => { if (node.floor !== null) availableFloors.add(node.floor); });
        // Add floors listed in the building data
        const bldgFloors = building.floorsWithMaps || building.floors;
        if (Array.isArray(bldgFloors)) bldgFloors.forEach(f => availableFloors.add(f));

        const sortedFloors = Array.from(availableFloors).filter(f => f != null).sort(sortFloors); // Use custom sort

        if (sortedFloors.length === 0) {
            const defaultFloor = '1'; // Use string '1' as default
            sortedFloors.push(defaultFloor);
            console.warn(`No floor info in path segment or building data for ${building.id}. Defaulting to ${defaultFloor}.`);
        }

        sortedFloors.forEach(floorNum => {
            const option = document.createElement('option');
            option.value = floorNum; // Value can be "B1", "1", etc.
            option.textContent = `${floorNum}층`; // Display as "B1층", "1층"
            indoorFloorSelector.appendChild(option);
        });

        const pathFloors = Array.from(segmentData.floors).filter(f => f != null).sort(sortFloors);
        const initialFloor = pathFloors.length > 0 ? pathFloors[0] : sortedFloors[0];
        indoorFloorSelector.value = initialFloor; // Set initial selection

        loadFloorImageAndDrawPath(building.id, initialFloor, segmentData.nodes);
        indoorMapView.classList.add('visible');
    }

    function hideIndoorMap() { indoorMapView.classList.remove('visible'); indoorMapImage.src = ''; indoorBuildingName.textContent = ''; indoorFloorSelector.innerHTML = '<option value="">--</option>'; while (indoorPathOverlay.firstChild) { indoorPathOverlay.removeChild(indoorPathOverlay.firstChild); } currentIndoorSegmentData = null; }
    function loadFloorImageAndDrawPath(buildingId, floorNum, allNodesInSegment) { const imagePath = `data/indoor_maps/${buildingId}_${floorNum}.png`; console.log(`Loading floor image: ${imagePath}`); indoorMapImage.src = imagePath; indoorMapImage.onerror = () => { console.error(`Error loading indoor map image: ${imagePath}`); indoorMapImage.alt = `${buildingId} ${floorNum}층 지도 로딩 실패`; while (indoorPathOverlay.firstChild) { indoorPathOverlay.removeChild(indoorPathOverlay.firstChild); } indoorMapImageContainer.style.backgroundColor = '#ddd'; }; indoorMapImage.onload = () => { console.log(`Image loaded: ${imagePath}`); indoorMapImage.alt = `${buildingId} ${floorNum}층 내부 지도`; indoorMapImageContainer.style.backgroundColor = 'rgba(238, 238, 238, 0.5)'; drawIndoorPathOnSVG(floorNum, allNodesInSegment); }; }

    function drawIndoorPathOnSVG(currentFloor, allNodesInSegment) {
        while (indoorPathOverlay.firstChild) { indoorPathOverlay.removeChild(indoorPathOverlay.firstChild); }
        const floorPathNodes = []; const entranceNodesOnFloor = []; const segmentNodeIds = allNodesInSegment.map(n => n.id);
        const currentFloorStr = String(currentFloor); // Ensure comparison is string vs string

        allNodesInSegment.forEach((node, index) => {
            const nodeFloorStr = node.floor !== null && node.floor !== undefined ? String(node.floor) : null;
            if (node.nodeType === 'indoor' && nodeFloorStr === currentFloorStr) {
                floorPathNodes.push(node);
            } else if (node.nodeType === 'entrance') {
                const prevNode = allNodesInSegment[index - 1];
                const nextNode = allNodesInSegment[index + 1];
                const prevFloorStr = prevNode && prevNode.floor !== null && prevNode.floor !== undefined ? String(prevNode.floor) : null;
                const nextFloorStr = nextNode && nextNode.floor !== null && nextNode.floor !== undefined ? String(nextNode.floor) : null;

                if ((prevNode && prevNode.nodeType === 'indoor' && prevFloorStr === currentFloorStr) ||
                    (nextNode && nextNode.nodeType === 'indoor' && nextFloorStr === currentFloorStr)) {
                    entranceNodesOnFloor.push(node);
                }
            }
        });
        let startNode = null; let endNode = null;
        if (entranceNodesOnFloor.length > 0 || floorPathNodes.length > 0) {
            // Find the earliest and latest node *on this floor* within the segment's sequence
            let firstIndex = -1, lastIndex = -1;
            const relevantNodes = [...entranceNodesOnFloor, ...floorPathNodes];
            relevantNodes.forEach(n => {
                const idx = segmentNodeIds.indexOf(n.id);
                if(firstIndex === -1 || idx < firstIndex) firstIndex = idx;
                if(lastIndex === -1 || idx > lastIndex) lastIndex = idx;
            });
            if (firstIndex !== -1) startNode = allNodesInSegment[firstIndex];
            if (lastIndex !== -1) endNode = allNodesInSegment[lastIndex];
        }

        if (!startNode || !endNode) { console.log(`No relevant path nodes found for floor ${currentFloorStr}.`); return; }
        console.log(`Drawing simplified path for floor ${currentFloorStr} from ${startNode.id} to ${endNode.id}`);
        const svgNS = "http://www.w3.org/2000/svg"; const svgWidth = indoorPathOverlay.clientWidth || 300; const svgHeight = indoorPathOverlay.clientHeight || 200; const padding = 20; const startX = padding; const startY = svgHeight / 2; const endX = svgWidth - padding; const endY = svgHeight / 2; const pointsString = `${startX},${startY} ${endX},${endY}`; const polyline = document.createElementNS(svgNS, "polyline"); polyline.setAttribute("points", pointsString); indoorPathOverlay.appendChild(polyline); const startCircle = document.createElementNS(svgNS, "circle"); startCircle.setAttribute("cx", startX); startCircle.setAttribute("cy", startY); startCircle.setAttribute("r", "6"); startCircle.setAttribute("fill", startNode.nodeType === 'entrance' ? "orange" : "green"); indoorPathOverlay.appendChild(startCircle); const endCircle = document.createElementNS(svgNS, "circle"); endCircle.setAttribute("cx", endX); endCircle.setAttribute("cy", endY); endCircle.setAttribute("r", "6"); endCircle.setAttribute("fill", endNode.nodeType === 'entrance' ? "orange" : "blue"); indoorPathOverlay.appendChild(endCircle); const indoorNodesBetween = floorPathNodes.filter(node => node.id !== startNode.id && node.id !== endNode.id); if (indoorNodesBetween.length > 0) { const numIntermediate = indoorNodesBetween.length; for (let i = 0; i < numIntermediate; i++) { const intermediateX = startX + (endX - startX) * ((i + 1) / (numIntermediate + 1)); const intermediateY = startY; const midCircle = document.createElementNS(svgNS, "circle"); midCircle.setAttribute("cx", intermediateX.toFixed(1)); midCircle.setAttribute("cy", intermediateY.toFixed(1)); midCircle.setAttribute("r", "4"); midCircle.setAttribute("fill", "red"); indoorPathOverlay.appendChild(midCircle); } }
    }

    function updateToggleIndicator(isExpanded) {}
    function setupControlsToggle() {
         if (controlsPanel && controlsTitle) {
             const clickHandler = (event) => {
                 if (window.innerWidth <= 600) {
                     if (event.target === controlsTitle || event.target === toggleIndicator || event.target.parentNode === controlsTitle) {
                        const isExpanded = controlsPanel.classList.toggle('controls-expanded');
                        console.log("Controls toggled, expanded:", isExpanded);
                         if (isAdminMode) updateAdminVisibility();
                     } else { console.log("Click inside H1 ignored (not on title/indicator)"); }
                 }
            };
            controlsTitle.addEventListener('click', clickHandler);
             const mediaQuery = window.matchMedia('(max-width: 600px)');
             const handleResize = () => {
                if (mediaQuery.matches) {
                    if (!controlsPanel.classList.contains('init-mobile')) {
                         controlsPanel.classList.remove('controls-expanded');
                         controlsPanel.classList.add('init-mobile');
                    }
                 } else {
                     controlsPanel.classList.add('controls-expanded');
                     controlsPanel.classList.remove('init-mobile');
                 }
                 if (isAdminMode) updateAdminVisibility();
            };
             if (mediaQuery.matches) {
                 controlsPanel.classList.remove('controls-expanded');
                 controlsPanel.classList.add('init-mobile');
             } else {
                 controlsPanel.classList.add('controls-expanded');
             }
             mediaQuery.addEventListener('change', handleResize);
         } else { console.error("Could not find controls panel or its H1 title element for toggle setup."); }
     }
     const updateAdminVisibility = () => {
         if (isAdminMode && adminControlsContainer) {
             const mobileMediaQuery = window.matchMedia('(max-width: 600px)');
             if (controlsPanel.classList.contains('controls-expanded') || !mobileMediaQuery.matches) {
                 adminControlsContainer.style.display = 'block';
                 adminControlsContainer.style.setProperty('display', 'block', 'important');
             } else {
                  adminControlsContainer.style.display = 'none';
                  adminControlsContainer.style.removeProperty('display');
             }
         }
     };

    function initializeApp() {
        if (!schLocation || !buildingsData || !pathNodesData || !pathEdgesData) { console.error("Initialization failed: Missing critical data."); document.getElementById('controls').innerHTML = '<h2>오류</h2><p>필수 데이터 로드 실패.</p>'; return; }
        console.log("Initializing app...");
        map = L.map('map', { zoomControl: true }).setView([schLocation.lat, schLocation.lng], 16);
        L.control.scale({ imperial: false }).addTo(map);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자' }).addTo(map);
        searchMarkers.addTo(map); routeLayer.addTo(map); indoorSegmentMarkers.addTo(map);
        const urlParams = new URLSearchParams(window.location.search); isAdminMode = urlParams.get('code') === 'admin';
        if (isAdminMode) {
            console.log("ADMIN MODE ACTIVATED.");
            if (adminControlsContainer) adminControlsContainer.style.display = 'block';
            adminNodeMarkersLayer.addTo(map); adminEdgeLayer.addTo(map);
            pathNodesData.forEach(node => addAdminNodeMarker(node));
            pathEdgesData.forEach(edge => addAdminEdgeLine(edge, false));
            map.on('click', (e) => {
                if (firstNodeForEdge) {
                    showAdminFeedback("엣지 연결 취소됨 (맵 클릭).");
                    if (selectedMarkerForEdge) { const nodeD = selectedMarkerForEdge.options.nodeData; if(nodeD) selectedMarkerForEdge.setIcon(createAdminNodeIcon(nodeD.nodeType || 'outdoor', false)); if(selectedMarkerForEdge.isPopupOpen()) selectedMarkerForEdge.closePopup(); }
                    firstNodeForEdge = null; selectedMarkerForEdge = null;
                }
            });
            updateAdminVisibility();
        }
        else { if (adminControlsContainer) adminControlsContainer.style.display = 'none'; }
        pathGraph = buildGraph();
        initializeSearchData(); initializeFacilityLayers(); createFacilityTypeSelectorUI();
        searchButton.addEventListener('click', () => displaySearchResults(searchInput.value)); searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); displaySearchResults(searchInput.value); } });
        resetButton.addEventListener('click', resetAll);
        locateMeButton.addEventListener('click', startUserTrackingAndSetStart);
        const preferenceRadios = document.querySelectorAll('input[name="routePref"]');
        preferenceRadios.forEach(radio => {
            radio.addEventListener('change', (event) => {
                currentUserPreference = event.target.value;
                console.log("Preference changed to:", currentUserPreference);
                if (startLocation && startLocation.lat != null && endLocation && endLocation.lat != null) {
                     console.log("Recalculating route due to preference change...");
                     clearTimeout(findRouteDebounceTimer);
                     const prefRadio = document.querySelector(`input[name="routePref"][value="${currentUserPreference}"]`);
                     const prefText = prefRadio ? prefRadio.parentElement.textContent.trim() : currentUserPreference;
                     updateRouteInfo(`경로 재탐색 중 (${prefText} 우선)...`, 'info');
                     findRouteDebounceTimer = setTimeout(() => {
                        findRoute();
                     }, 50);
                }
            });
        });
        map.on('contextmenu', handleContextMenu);
        indoorMapCloseButton.addEventListener('click', hideIndoorMap);
        indoorFloorSelector.addEventListener('change', (e) => {
             // Use e.target.value directly as it's already "B1", "1", etc.
             const selectedFloor = e.target.value;
             if (selectedFloor && currentIndoorSegmentData) {
                 loadFloorImageAndDrawPath(currentIndoorSegmentData.buildingId, selectedFloor, currentIndoorSegmentData.nodes);
             }
        });
        indoorMapView.addEventListener('click', (e) => { if (e.target === indoorMapView) { hideIndoorMap(); } });
        if (isAdminMode) { if (exportNodesButton) exportNodesButton.addEventListener('click', () => exportData(pathNodesData, 'pathNodes_updated.json')); if (exportEdgesButton) exportEdgesButton.addEventListener('click', () => exportData(pathEdgesData, 'pathEdges_updated.json')); }
        setupControlsToggle();
        console.log("Leaflet Campus Map Initialized.");
    }

    async function loadData() {
        console.log("Loading data...");
        const dataFiles = { cf: 'data/config.json', bu: 'data/buildings.json', cl: 'data/classrooms.json', fa: 'data/facilities.json', no: 'data/pathNodes.json', ed: 'data/pathEdges.json' };
        try {
            const responses = await Promise.all(Object.values(dataFiles).map(url => fetch(url + '?v=' + Date.now())));
            const errors = responses.filter(res => !res.ok); if(errors.length > 0) { const failedUrl = dataFiles[Object.keys(dataFiles)[responses.findIndex(res => !res.ok)]]; throw new Error(`Failed to load ${failedUrl} (Status: ${errors[0].status})`); }
            const [cfData, buData, clData, faData, noData, edData] = await Promise.all(responses.map(res => res.json()));
            schLocation = cfData.schLocation; buildingsData = buData; classroomsData = clData; facilitiesData = faData;
            // Ensure floor is consistently handled (e.g., stored as string if 'B' involved)
            pathNodesData = noData.map(n => ({
                 ...n,
                 nodeType: n.nodeType || 'outdoor',
                 floor: n.floor !== null && n.floor !== undefined ? String(n.floor) : null // Store floor as string
            }));
            pathEdgesData = edData;
            console.log("Data loaded successfully:", { Config: !!schLocation, Buildings: buildingsData.length, Classrooms: classroomsData.length, Facilities: facilitiesData.length, Nodes: pathNodesData.length, Edges: pathEdgesData.length });
            initializeApp();
        } catch (error) {
            console.error("Error loading data:", error);
            const controlsPanel = document.getElementById('controls');
            if (controlsPanel) { controlsPanel.innerHTML = `<h1>오류</h1><p>데이터 로딩 중 문제가 발생했습니다:</p><p style="color: var(--danger-color-text, red); font-weight: bold;">${error.message}</p><p>파일 경로 및 내용을 확인하고 페이지를 새로고침 해주세요.</p>`; controlsPanel.style.display = 'block'; controlsPanel.style.height = 'auto'; controlsPanel.style.maxHeight = 'none';}
            const mapDiv = document.getElementById('map');
            if (mapDiv) mapDiv.innerHTML = '<p style="padding:20px; text-align:center; font-weight:bold; color:var(--danger-color-text, red);">맵 로딩 실패: 데이터 오류</p>';
        }
    }

    loadData();

});
