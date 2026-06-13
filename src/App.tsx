import { useState, useEffect, useRef, useMemo, ChangeEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  Upload, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  Search, 
  MapPin, 
  Map as MapIcon, 
  Table, 
  Info,
  ChevronRight,
  RefreshCw,
  Plus,
  Compass,
  FileSpreadsheet,
  X,
  Filter
} from 'lucide-react';
import defaultSurveyData from "./data/survey.json";
import { SurveyCollection, SurveyFeature } from "./types";

export default function App() {
  // --- States ---
  const [surveyData, setSurveyData] = useState<SurveyCollection>(defaultSurveyData as SurveyCollection);
  const [filterUnsurveyedOnly, setFilterUnsurveyedOnly] = useState<boolean>(false);
  const [visibleLayers, setVisibleLayers] = useState<string[]>(["LAYER1", "LAYER2"]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedPoint, setSelectedLayerPoint] = useState<SurveyFeature | null>(null);

  // Toggle Visibility Helper
  const toggleLayerVisibility = (layer: string) => {
    setVisibleLayers(prev => {
      if (prev.includes(layer)) {
        return prev.filter(l => l !== layer);
      } else {
        return [...prev, layer];
      }
    });
  };
  
  // Tab states for sidebar panels
  const [activeTab, setActiveTab] = useState<"summary" | "list">("summary");
  
  // Edit remark state
  const [editingRemark, setEditingRemark] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  
  // Map Type state
  const [mapType, setMapType] = useState<"osm" | "satellite" | "light" | "topo">("light");

  // DOM Refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const highlightCircleRef = useRef<L.CircleMarker | null>(null);

  // --- Derived Statistics ---
  const stats = useMemo(() => {
    const features = surveyData.features;
    const total = features.length;
    
    // Count based on REMARKS (if empty or empty spaces -> pending/รอสำรวจ, otherwise done/สำรวจแล้ว)
    const surveyed = features.filter(f => f.properties.REMARKS && f.properties.REMARKS.trim() !== "").length;
    const remaining = total - surveyed;
    
    // Layer breakdown
    const layersMap: Record<string, { total: number; surveyed: number; pending: number }> = {};
    features.forEach(f => {
      const ly = f.properties.LAYER || "UNKNOWN";
      if (!layersMap[ly]) {
        layersMap[ly] = { total: 0, surveyed: 0, pending: 0 };
      }
      layersMap[ly].total += 1;
      if (f.properties.REMARKS && f.properties.REMARKS.trim() !== "") {
        layersMap[ly].surveyed += 1;
      } else {
        layersMap[ly].pending += 1;
      }
    });

    const percentComplete = total > 0 ? Math.round((surveyed / total) * 100) : 0;

    return {
      total,
      surveyed,
      remaining,
      percentComplete,
      layers: Object.entries(layersMap).map(([name, counts]) => ({
        name,
        ...counts
      })).sort((a, b) => b.total - a.total)
    };
  }, [surveyData]);

  // List of unique layer names for the dropdown
  const uniqueLayers = useMemo(() => {
    return Array.from(new Set(surveyData.features.map(f => f.properties.LAYER || "UNKNOWN"))).sort();
  }, [surveyData]);

  // Automatically sync visibleLayers when uniqueLayers changes
  useEffect(() => {
    if (uniqueLayers.length > 0) {
      setVisibleLayers(prev => {
        const next = [...prev];
        uniqueLayers.forEach(l => {
          if (!next.includes(l)) {
            next.push(l);
          }
        });
        return next.filter(l => uniqueLayers.includes(l));
      });
    }
  }, [uniqueLayers]);

  // --- Filtered Features for Display ---
  const filteredFeatures = useMemo(() => {
    return surveyData.features.filter(f => {
      // 1. Filter by REMARKS
      if (filterUnsurveyedOnly) {
        const isSurveyed = f.properties.REMARKS && f.properties.REMARKS.trim() !== "";
        if (isSurveyed) return false;
      }

      // 2. Filter by Layer Checkboxes
      const layerName = f.properties.LAYER || "UNKNOWN";
      if (!visibleLayers.includes(layerName)) return false;

      // 3. Filter by search query
      if (searchQuery.trim() !== "") {
        const q = searchQuery.toLowerCase();
        const nameMatch = f.properties.NAME?.toLowerCase().includes(q);
        const remarkMatch = f.properties.REMARKS?.toLowerCase().includes(q);
        const layerMatch = f.properties.LAYER?.toLowerCase().includes(q);
        const fixMatch = f.properties.FIX_TYPE?.toLowerCase().includes(q);
        
        if (!nameMatch && !remarkMatch && !layerMatch && !fixMatch) return false;
      }

      return true;
    });
  }, [surveyData, filterUnsurveyedOnly, visibleLayers, searchQuery]);

  // --- Map Initialization ---
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Create Map context centered on target region
    const defaultCoords: L.LatLngExpression = [13.220, 102.270]; // Center around standard survey dataset coordinates
    const map = L.map(mapContainerRef.current, {
      center: defaultCoords,
      zoom: 13,
      zoomControl: true
    });

    mapRef.current = map;

    // Base layers
    const layerLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; CartoDB'
    });
    layerLight.addTo(map);

    // Create marker group layer
    const markersGroup = L.layerGroup();
    markersGroup.addTo(map);
    markersGroupRef.current = markersGroup;

    // Clean up on unmount
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- Update Base Tiles ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing tile layer or re-add
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        map.removeLayer(layer);
      }
    });

    let url = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'; // default light
    let attr = '&copy; CartoDB';

    if (mapType === "osm") {
      url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      attr = '&copy; OpenStreetMap contributors';
    } else if (mapType === "satellite") {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      attr = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';
    } else if (mapType === "topo") {
      url = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
      attr = 'Map data: &copy; OSM contributors, SRTM | Map style: &copy; OpenTopoMap';
    }

    L.tileLayer(url, { attribution: attr }).addTo(map);
  }, [mapType]);

  // --- Redraw markers on feature updates or filters ---
  useEffect(() => {
    const map = mapRef.current;
    const markersGroup = markersGroupRef.current;
    if (!map || !markersGroup) return;

    // Clear old markers
    markersGroup.clearLayers();

    // Redraw points
    const bounds: L.LatLngTuple[] = [];

    // Rendering circle markers for optimal speeds with high count datasets
    filteredFeatures.forEach((feature) => {
      const geom = feature.geometry;
      if (!geom || geom.type !== "Point") return;

      const [lng, lat] = geom.coordinates;
      const isSurveyed = feature.properties.REMARKS && feature.properties.REMARKS.trim() !== "";
      
      const marker = L.circleMarker([lat, lng], {
        radius: 6,
        fillColor: isSurveyed ? '#10B981' : '#3B82F6', // Emerald Green vs Royal Blue
        color: '#FFFFFF',
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.85
      });

      // Bind interaction
      marker.on('click', () => {
        zoomToPoint(feature);
      });

      // Simple tooltip on hover
      marker.bindTooltip(`จุดสำรวจ: ${feature.properties.NAME || "N/A"} (${feature.properties.LAYER || "N/A"})`, {
        direction: 'top',
        offset: [0, -5]
      });

      marker.addTo(markersGroup);
      bounds.push([lat, lng]);
    });

    // Auto fit bounds only if there are active markers
    if (bounds.length > 0 && selectedPoint === null) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 16 });
    }
  }, [filteredFeatures]);

  // --- Highlight selected point on map ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old highlight marker
    if (highlightCircleRef.current) {
      map.removeLayer(highlightCircleRef.current);
      highlightCircleRef.current = null;
    }

    if (selectedPoint && selectedPoint.geometry && selectedPoint.geometry.type === "Point") {
      const [lng, lat] = selectedPoint.geometry.coordinates;
      const isSurveyed = selectedPoint.properties.REMARKS && selectedPoint.properties.REMARKS.trim() !== "";

      // Pulsing/glowing double-ring selection
      const highlight = L.circleMarker([lat, lng], {
        radius: 12,
        fillColor: 'transparent',
        color: isSurveyed ? '#10B981' : '#3B82F6',
        weight: 4,
        opacity: 0.8,
        className: 'animate-ping' // adds beautiful pulsing effects via custom/utility class if compiled
      });

      highlight.addTo(map);
      highlightCircleRef.current = highlight;

      // Fit map view
      map.setView([lat, lng], 16);

      // Construct and bind/show beautiful coordinates popup on map
      const remarksVal = selectedPoint.properties.REMARKS || "";
      const layerVal = selectedPoint.properties.LAYER || "N/A";
      const nameVal = selectedPoint.properties.NAME || "N/A";
      const isRemarksEmpty = !remarksVal || remarksVal.trim() === "";

      const statusHtml = isRemarksEmpty
        ? `<div class="mt-1 px-2.5 py-1 bg-amber-50 rounded text-amber-800 border border-amber-200 text-xs font-semibold">
             Status: Waiting for survey
           </div>`
        : `<div class="mt-1 px-2.5 py-1 bg-emerald-50 rounded text-emerald-800 border border-emerald-250 text-xs text-left">
             <div class="font-bold">Status: Surveyed</div>
             <div class="text-[11px] text-slate-650 mt-1">Remarks: <strong>${remarksVal}</strong></div>
           </div>`;

      const popupContent = `
        <div class="p-1 font-sans text-slate-800 min-w-[160px]">
          <h4 class="font-extrabold text-[#111827] border-b border-slate-100 pb-1.5 mb-2 flex items-center gap-1 text-sm">
            📌 Point #${nameVal}
          </h4>
          <div class="space-y-1.5 text-xs">
            <div><strong>Layer:</strong> <span class="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-bold rounded text-[10px] border border-indigo-100">${layerVal}</span></div>
            ${statusHtml}
          </div>
        </div>
      `;

      L.popup({
        offset: [0, -4],
        closeButton: true,
        className: 'custom-leaflet-popup'
      })
        .setLatLng([lat, lng])
        .setContent(popupContent)
        .openOn(map);
    } else {
      map.closePopup();
    }
  }, [selectedPoint]);

  // --- zoom and focus to feature ---
  const zoomToPoint = (feature: SurveyFeature) => {
    setSelectedLayerPoint(feature);
    setEditingRemark(feature.properties.REMARKS || "");
    setIsEditing(false);
    
    // Auto switch sidebar to detailed point panel info if suitable
    setActiveTab("list");
  };

  // --- Handle Custom GeoJSON Upload ---
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const file = fileList[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text) as SurveyCollection;
        
        if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
          alert("ไฟล์อัพโหลดไม่ใช่ GeoJSON FeatureCollection รูปแบบที่ต้องใช้");
          return;
        }

        // Validate basic properties
        const validateAlertFeatures = parsed.features.filter(f => f.geometry && f.geometry.type === "Point");
        if (validateAlertFeatures.length === 0) {
          alert("ไม่พบข้อมูลพิกัด (Point Data) ภายใน GeoJSON นี้");
          return;
        }

        // Adjust any empty or missing remarks fields for safety
        const cleanedFeatures = parsed.features.map(f => ({
          ...f,
          properties: {
            ...f.properties,
            REMARKS: f.properties.REMARKS || ""
          }
        }));

        setSurveyData({
          ...parsed,
          features: cleanedFeatures
        });
        setSelectedLayerPoint(null);
        alert(`โหลดจุดสำรวจเสร็จสมบูรณ์: อ่านพบข้อมูลสำรวจทั้งหมด ${cleanedFeatures.length} จุด`);
      } catch (err) {
        alert("การประมวลผลไฟล์ล้มเหลว กรุณาจัดระเบียบไฟล์ .geojson ให้ถูกต้อง");
      }
    };
    reader.readAsText(file);
  };

  // --- Save / Update Remarks inside memory state ---
  const handleUpdateRemarks = () => {
    if (!selectedPoint) return;

    const updatedFeatures = surveyData.features.map(f => {
      if (f.properties.NAME === selectedPoint.properties.NAME && f.properties.LAYER === selectedPoint.properties.LAYER) {
        return {
          ...f,
          properties: {
            ...f.properties,
            REMARKS: editingRemark
          }
        };
      }
      return f;
    });

    const updatedCollection = {
      ...surveyData,
      features: updatedFeatures
    };

    setSurveyData(updatedCollection);
    
    // Update active chosen reference point
    const updatedActivePoint = updatedFeatures.find(f => f.properties.NAME === selectedPoint.properties.NAME && f.properties.LAYER === selectedPoint.properties.LAYER);
    if (updatedActivePoint) {
      setSelectedLayerPoint(updatedActivePoint);
    }
    
    setIsEditing(false);
  };

  // --- Download customized/updated survey geojson ---
  const handleDownloadGeoJSON = () => {
    const geojsonData = JSON.stringify(surveyData, null, 2);
    const blob = new Blob([geojsonData], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `survey_points_updated_${new Date().toISOString().split('T')[0]}.geojson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Switch status back and forth quickly
  const toggleSurveyStatusQuick = (feature: SurveyFeature) => {
    const isCurrentlySurveyed = feature.properties.REMARKS && feature.properties.REMARKS.trim() !== "";
    const newRemarks = isCurrentlySurveyed ? "" : "สำรวจแล้วเสร็จ (Survey Completed)";
    
    const updatedFeatures = surveyData.features.map(f => {
      if (f.properties.NAME === feature.properties.NAME && f.properties.LAYER === feature.properties.LAYER) {
        return {
          ...f,
          properties: {
            ...f.properties,
            REMARKS: newRemarks
          }
        };
      }
      return f;
    });

    setSurveyData({
      ...surveyData,
      features: updatedFeatures
    });

    if (selectedPoint && selectedPoint.properties.NAME === feature.properties.NAME && selectedPoint.properties.LAYER === feature.properties.LAYER) {
      setSelectedLayerPoint({
        ...selectedPoint,
        properties: {
          ...selectedPoint.properties,
          REMARKS: newRemarks
        }
      });
      setEditingRemark(newRemarks);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 overflow-hidden font-sans text-slate-800">
      
      {/* Top Navigation / App header */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-white border-b border-slate-100 shrink-0 shadow-xs z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-600 shadow-md shadow-indigo-600/15 text-white font-bold">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold font-display tracking-tight text-slate-900">
              GeoMerge & Field Surveyor
            </h1>
            <p className="text-xs text-slate-500">
              สถานีแผนที่สำรวจจุดพิกัดและวิเคราะห์ความคืบหน้า (React Leaflet)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Default file label */}
          <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-slate-50 text-slate-600 border border-slate-200/60">
            <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
            พิกัดข้อมูลปัจจุบัน: <strong className="text-indigo-600 font-bold ml-1">{stats.total}</strong> จุด
          </span>

          {/* Load customer GeoJSON */}
          <label className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-white hover:bg-slate-50 text-slate-700 transition cursor-pointer border border-slate-200 shadow-xs">
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            <span>นำเข้า GeoJSON</span>
            <input 
              type="file" 
              accept=".geojson,.json" 
              onChange={handleFileUpload} 
              className="hidden" 
            />
          </label>

          {/* Export customer GeoJSON */}
          <button 
            onClick={handleDownloadGeoJSON}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-sm cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>ส่งออก .GeoJSON (ใหม่)</span>
          </button>
        </div>
      </header>


      {/* Main Container: Split columns */}
      <div className="flex flex-1 w-full min-h-0 overflow-hidden relative">

        {/* Dashboard Actions and stats left sidebar */}
        <aside className="w-full lg:w-96 flex flex-col bg-white border-r border-slate-200 min-h-0 shrink-0 z-10 shadow-xs">
          
          {/* Quick Stats Grid */}
          <div className="p-4 bg-slate-50/50 border-b border-slate-100 grid grid-cols-2 gap-3 shrink-0">
            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs transition hover:border-slate-350">
              <span className="text-[10px] text-slate-500 block tracking-wider uppercase font-bold">จำนวนจุดพิกัดทั้งหมด</span>
              <span className="text-2xl font-extrabold font-display tracking-tight text-slate-900 block mt-0.5">
                {stats.total.toLocaleString()} <span className="text-xs font-normal text-slate-500">จุด</span>
              </span>
            </div>
            
            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs transition hover:border-slate-350">
              <span className="text-[10px] text-slate-500 block tracking-wider uppercase font-bold">ความคืบหน้าภาพรวม</span>
              <span className="text-2xl font-extrabold font-display tracking-tight text-indigo-600 block mt-0.5">
                {stats.percentComplete}%
              </span>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs transition hover:border-slate-350 flex items-center justify-between col-span-2">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 ring-4 ring-emerald-500/15" />
                <div>
                  <span className="text-[10px] text-slate-500 block font-bold uppercase">สำรวจเรียบร้อย</span>
                  <span className="text-sm font-bold text-slate-800 block">
                    {stats.surveyed.toLocaleString()} จุด
                  </span>
                </div>
              </div>

              <div className="h-8 w-px bg-slate-200" />

              <div className="flex items-center gap-2.5 text-right justify-end">
                <div>
                  <span className="text-[10px] text-slate-500 block font-bold uppercase">คงเหลือรอดำเนินงาน</span>
                  <span className="text-sm font-bold text-indigo-600 block">
                    {stats.remaining.toLocaleString()} จุด
                  </span>
                </div>
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0 ring-4 ring-blue-500/15" />
              </div>
            </div>

            {/* Custom Progress Bar */}
            <div className="col-span-2 bg-slate-100 h-3 rounded-full overflow-hidden border border-slate-200 p-0.5">
              <div 
                className="h-full bg-indigo-600 rounded-full transition-all duration-500" 
                style={{ width: `${stats.percentComplete}%` }}
              />
            </div>
          </div>

          {/* Tabs header inside Sidebar */}
          <div className="flex bg-slate-50/50 border-b border-slate-100 shrink-0">
            <button 
              onClick={() => setActiveTab("summary")}
              className={`flex-1 py-3 text-xs font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${
                activeTab === "summary" 
                  ? "border-indigo-600 bg-white text-indigo-600" 
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Layers className="w-4 h-4" />
              สรุปจำแนกชั้นข้อมูล
            </button>
            <button 
              onClick={() => setActiveTab("list")}
              className={`flex-1 py-3 text-xs font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${
                activeTab === "list" 
                  ? "border-indigo-600 bg-white text-indigo-600" 
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Table className="w-4 h-4" />
              รายการสำรวจ ({filteredFeatures.length})
            </button>
          </div>

          {/* TAB 1: SUMMARY LAYER VIEW */}
          {activeTab === "summary" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {/* Conditional Filters Block */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 shadow-xs">
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 font-display uppercase tracking-wide">
                  <Filter className="w-3.5 h-3.5 text-indigo-600" />
                  ตัวกรองและควบคุมพิกัดแผนที่
                </h4>

                {/* Hide / Show Completed Button */}
                <button
                  onClick={() => setFilterUnsurveyedOnly(!filterUnsurveyedOnly)}
                  className={`w-full py-2 px-3 text-xs font-bold rounded-lg border transition flex items-center justify-center gap-2 cursor-pointer ${
                    filterUnsurveyedOnly 
                      ? "bg-indigo-50 text-indigo-600 border-indigo-200" 
                      : "bg-white hover:bg-slate-50 text-slate-600 border-slate-200"
                  }`}
                >
                  <AlertCircle className="w-4 h-4 text-indigo-400" />
                  <span>แสดงเฉพาะจุดที่ 'ยังไม่สำรวจ' เท่านั้น</span>
                  {filterUnsurveyedOnly && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-indigo-600" />
                  )}
                </button>

                {/* Individual Layer Toggle Checkboxes */}
                <div className="space-y-2 pt-1 border-t border-slate-200/60">
                  <label className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider mb-1">
                    แสดงชั้นข้อมูลแผนที่ (Layer Visibility)
                  </label>
                  <div className="space-y-2 bg-white p-3 rounded-lg border border-slate-200/85 shadow-xs">
                    {uniqueLayers.map((ly) => {
                      const isChecked = visibleLayers.includes(ly);
                      return (
                        <label 
                          key={ly} 
                          className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none py-0.5 hover:text-indigo-600 transition"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleLayerVisibility(ly)}
                            className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                          />
                          <span className="font-semibold">{ly}</span>
                          <span className="ml-auto text-[10px] bg-slate-50 px-2 py-0.5 rounded text-slate-400 border border-slate-100 font-bold">
                            {surveyData.features.filter(f => (f.properties.LAYER || "UNKNOWN") === ly).length} จุด
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Layer Stats Breakdown list */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider block px-1">
                  สรุปรายละเอียดราย LAYER ({stats.layers.length})
                </h3>

                <div className="space-y-2">
                  {stats.layers.map(layer => {
                    const layerProgressPercent = layer.total > 0 ? Math.round((layer.surveyed / layer.total) * 100) : 0;
                    const isVisible = visibleLayers.includes(layer.name);
                    return (
                      <div 
                        key={layer.name}
                        onClick={() => toggleLayerVisibility(layer.name)}
                        className={`p-3 bg-white border rounded-xl hover:border-slate-350 transition cursor-pointer ${
                          isVisible ? "border-indigo-600 bg-indigo-50/5 ring-1 ring-indigo-600/10" : "border-slate-200/85 opacity-65"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded bg-indigo-500" />
                            {layer.name}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            ความคืบหน้า <strong className="text-slate-800 font-bold">{layerProgressPercent}%</strong>
                          </span>
                        </div>

                        {/* Staggered totals */}
                        <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-600 py-1 bg-slate-50 rounded-lg px-2 text-center mb-2">
                          <div>
                            <span className="text-[9px] text-slate-400 block font-bold">ทั้งหมด</span>
                            <span className="font-bold text-slate-800">{layer.total}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-emerald-600 block font-bold">สำรวจแล้ว</span>
                            <span className="font-bold text-emerald-650">{layer.surveyed}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-blue-600 block font-bold">รอสำรวจ</span>
                            <span className="font-bold text-blue-650">{layer.pending}</span>
                          </div>
                        </div>

                        {/* Layer specific minimal progress bar */}
                        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                            style={{ width: `${layerProgressPercent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Instructions and Legend Card */}
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3 text-xs text-slate-300 shadow-lg">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-indigo-400" />
                  คำชี้แจงสัญลักษณ์ (LEGEND)
                </span>
                
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-blue-500 block shrink-0" />
                    <span><strong>สถานะ 'รอสำรวจ' (Pending)</strong>: REMARKS เป็นค่าว่าง (สัญลักษณ์ Marker สีน้ำเงิน)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500 block shrink-0" />
                    <span><strong>สถานะ 'สำรวจแล้ว' (Surveyed)</strong>: REMARKS มีข้อความ (สัญลักษณ์ Marker สีเขียว)</span>
                  </div>
                </div>

                <div className="bg-slate-950 p-2.5 rounded-lg text-slate-400 border border-slate-800/80 text-[11px] leading-relaxed">
                  💡 คุณสามารถอัพเดทสเตตัสพิกัด ด้วยการคลิกเลือกจุดบนแผนที่หรือในแท็บรายการ และพิมพ์ Remarks เพื่อเปลี่ยนสีแผนที่ในพริบตา!
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DETAILED LIST OF POINTS */}
          {activeTab === "list" && (
            <div className="flex-1 overflow-hidden flex flex-col">
              
              {/* Search query input */}
              <div className="p-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-450 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="พิมพ์รหัสพิกัด, layer, หรือคำเพื่อค้นหา..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 text-xs bg-white text-slate-800 border border-slate-200 rounded-lg py-2 px-3 focus:outline-none focus:border-indigo-500"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-2 hover:text-red-500 text-slate-450 font-bold cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Sub search metadata details */}
                <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-slate-500">
                  <span>พบทั้งหมด: <strong className="text-slate-800 font-bold">{filteredFeatures.length}</strong> พิกัด</span>
                  {visibleLayers.length < uniqueLayers.length && (
                    <span>Layer: <strong className="text-indigo-600 font-bold">{visibleLayers.join(", ")}</strong></span>
                  )}
                </div>
              </div>

              {/* Selected point details panel (grows above list) */}
              {selectedPoint && (
                <div className="p-4 bg-slate-50 border-b border-indigo-100/80 space-y-3 shrink-0 relative shadow-xs">
                  
                  <button 
                    onClick={() => setSelectedLayerPoint(null)}
                    className="absolute right-3 top-3 hover:text-slate-800 text-slate-400 cursor-pointer"
                  >
                    <X className="w-4.5 h-4.5" />
                  </button>

                  <div className="flex items-center gap-2 text-indigo-650 font-bold text-xs uppercase tracking-wide">
                    <MapPin className="w-4 h-4 text-indigo-500 animate-bounce" />
                    <span>ข้อมูลจุดสำรวจพิกัดที่เลือก</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 block font-bold">ชื่อพิกัด (NAME)</span>
                      <strong className="text-slate-900 text-sm font-extrabold">{selectedPoint.properties.NAME || "N/A"}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block font-bold">ชั้นข้อมูล (LAYER)</span>
                      <span className="px-2 py-0.5 text-[10px] rounded bg-indigo-50 text-indigo-600 font-bold tracking-tight inline-block border border-indigo-100">
                        {selectedPoint.properties.LAYER || "N/A"}
                      </span>
                    </div>

                    <div className="col-span-2 h-px bg-slate-200/50 my-1" />

                    <div>
                      <span className="text-[10px] text-slate-500 block font-bold">ละติจูด/ลองจิจูด (COORDS)</span>
                      <span className="text-slate-700 font-mono">
                        {selectedPoint.geometry.coordinates[1]?.toFixed(7)}, {selectedPoint.geometry.coordinates[0]?.toFixed(7)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block font-bold">ค่าระดับดิน (ELEVATION)</span>
                      <span className="text-slate-800 font-bold">
                        {selectedPoint.properties.ELEVATION != null ? `${selectedPoint.properties.ELEVATION.toFixed(3)} ม.` : "N/A"}
                      </span>
                    </div>

                    <div className="col-span-2 h-px bg-slate-200/50 my-1" />

                    <div>
                      <span className="text-[10px] text-slate-500 block font-semibold">ความละเอียดแนวราบ (ACC_H)</span>
                      <span className="text-slate-700">
                        {selectedPoint.properties.ACC_H != null ? `${(selectedPoint.properties.ACC_H * 105).toFixed(1)} ซม.` : "N/A"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block font-semibold">ความละเอียดแนวตั้ง (ACC_V)</span>
                      <span className="text-slate-700">
                        {selectedPoint.properties.ACC_V != null ? `${(selectedPoint.properties.ACC_V * 105).toFixed(1)} ซม.` : "N/A"}
                      </span>
                    </div>

                    <div className="col-span-2 h-px bg-slate-200/50 my-1" />

                    {/* Remarks Input */}
                    <div className="col-span-2 space-y-1.5">
                      <span className="text-[10px] text-slate-500 block font-bold uppercase tracking-wide">
                        บันทึกข้อความจากสนาม (REMARKS)
                      </span>
                      
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingRemark}
                            onChange={(e) => setEditingRemark(e.target.value)}
                            placeholder="พิมพ์ข้อความเพื่อบันทึกงานสำรวจพิกัด..."
                            className="w-full text-xs bg-white border border-slate-300 rounded-lg p-2.5 focus:outline-none focus:border-indigo-500 text-slate-800 min-h-[50px] shadow-xs"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={handleUpdateRemarks}
                              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 transition rounded text-white font-bold text-xs cursor-pointer shadow-xs"
                            >
                              บันทึก
                            </button>
                            <button
                              onClick={() => {
                                setEditingRemark(selectedPoint.properties.REMARKS || "");
                                setIsEditing(false);
                              }}
                              className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 transition rounded text-slate-700 text-xs cursor-pointer shadow-xs"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-start justify-between gap-2 shadow-xs">
                          <div className="text-xs text-slate-700 flex-1 min-h-[1.5rem]">
                            {selectedPoint.properties.REMARKS ? (
                              <span className="text-emerald-600 flex items-center gap-1.5 font-medium">
                                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                                {selectedPoint.properties.REMARKS}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">ยังไม่มีบันทึกข้อมูล (สถานะหลัก: รอสำรวจ)</span>
                            )}
                          </div>
                          <button
                            onClick={() => setIsEditing(true)}
                            className="text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline shrink-0 font-bold self-start mt-0.5 cursor-pointer"
                          >
                            แก้ไขบันทึก
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick toggle Survey status bar */}
                  <div className="pt-2 border-t border-slate-200 mt-2 flex justify-between items-center text-[11px]">
                    <span className="text-slate-500">สลับสถานะสำรวจด่วน</span>
                    <button
                      onClick={() => toggleSurveyStatusQuick(selectedPoint)}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                        selectedPoint.properties.REMARKS && selectedPoint.properties.REMARKS.trim() !== ""
                          ? "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                          : "bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                      }`}
                    >
                      {selectedPoint.properties.REMARKS && selectedPoint.properties.REMARKS.trim() !== ""
                        ? "เปลี่ยนเป็น 'ยังไม่สำรวจ'"
                        : "เปลี่ยนเป็น 'สำรวจแล้ว'"}
                    </button>
                  </div>
                </div>
              )}

              {/* Scrollable list viewport of filtered elements */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 bg-white">
                {filteredFeatures.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center h-full text-slate-400 space-y-2">
                    <AlertCircle className="w-8 h-8 text-slate-300" />
                    <p className="text-xs">ไม่พบจุดสำรวจสอดคล้องกับปัจจัยกรองระบุ</p>
                  </div>
                ) : (
                  filteredFeatures.map((feat) => {
                    const isSurveyed = feat.properties.REMARKS && feat.properties.REMARKS.trim() !== "";
                    const isSelected = selectedPoint && selectedPoint.properties.NAME === feat.properties.NAME && selectedPoint.properties.LAYER === feat.properties.LAYER;

                    return (
                      <div
                        key={`${feat.properties.LAYER}-${feat.properties.NAME}`}
                        onClick={() => zoomToPoint(feat)}
                        className={`p-3 text-xs flex items-center justify-between gap-3 cursor-pointer transition ${
                          isSelected ? "bg-indigo-50/50 border-l-4 border-l-indigo-600 font-bold" : "bg-white hover:bg-slate-50/70"
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-slate-850"># {feat.properties.NAME}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-50 border border-slate-200 text-slate-500 font-medium scale-90">
                              {feat.properties.LAYER}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-500 flex items-center gap-1">
                            <span>Elev: {feat.geometry.coordinates[2] != null ? `${feat.geometry.coordinates[2].toFixed(1)}ม.` : "N/A"}</span>
                            <span>•</span>
                            <span className="truncate max-w-[120px]">File: {feat.properties.FILE_NAME || "N/A"}</span>
                          </div>

                          {feat.properties.REMARKS && (
                            <p className="text-[10px] text-emerald-600 truncate max-w-[200px] flex items-center gap-1 font-medium">
                              ✏️ {feat.properties.REMARKS}
                            </p>
                          )}
                        </div>

                        {/* Status Icon Pillar Badge */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                            isSurveyed 
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-150" 
                              : "bg-blue-50 text-blue-750 border border-blue-150"
                          }`}>
                            {isSurveyed ? "สำรวจแล้ว" : "รอดำเนินการ"}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Map Area Panel (Right-column) */}
        <main className="flex-1 h-full min-w-0 bg-slate-50 relative">
          
          {/* Map Instance Canvas */}
          <div ref={mapContainerRef} className="w-full h-full z-10" />

          {/* Map Layer Mode Switching Overlay Floating Bar */}
          <div className="absolute top-5 left-5 z-[500] bg-white/95 border border-slate-200 rounded-xl p-2 shadow-lg backdrop-blur-md flex items-center gap-2.5">
            <div className="text-slate-500 flex items-center gap-1.5 select-none text-[10px] font-bold uppercase tracking-wider pr-2 border-r border-slate-200">
              <MapIcon className="w-4 h-4 text-indigo-600" />
              <span>ภาพพื้นหลัง</span>
            </div>

            <div className="flex items-center gap-1">
              {[
                { id: "light", label: "โหมดสว่าง" },
                { id: "osm", label: "แผนที่ถนน" },
                { id: "satellite", label: "ภาพถ่ายดาวเทียม" },
                { id: "topo", label: "แผนที่ภูมิประเทศ" }
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setMapType(opt.id as any)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition leading-none select-none cursor-pointer ${
                    mapType === opt.id 
                      ? "bg-indigo-600 text-white shadow-sm" 
                      : "text-slate-600 hover:bg-slate-100/80"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Floating map coordinates tooltip */}
          <div className="absolute bottom-5 right-5 z-[500] bg-white/95 border border-slate-200 rounded-lg py-1.5 px-3 shadow-md select-none text-[11px] font-mono text-slate-700">
            📡 GNSS RTK • {filteredFeatures.length.toLocaleString()} จุดกรองแสดงผล
          </div>
        </main>

      </div>
    </div>
  );
}
