export interface SurveyFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: number[]; // [Lng, Lat, Elev]
  };
  properties: {
    NAME: string;
    LAYER: string;
    ELEVATION?: number | null;
    FIX_TYPE?: string | null;
    ACC_H?: number | null;
    ACC_V?: number | null;
    FILE_NAME?: string | null;
    REMARKS: string;
    [key: string]: any;
  };
  id?: string | number;
}

export interface SurveyCollection {
  type: "FeatureCollection";
  features: SurveyFeature[];
}
