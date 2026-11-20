export type KinectMember={id:string;prediction:'ASD'|'Typical';asdVotes:number;typicalVotes:number;threshold:number;checkpoints:{seed:number;asdScore:number}[]}
export type KinectResult={prediction:'ASD'|'Typical';asdVotes:number;typicalVotes:number;modelBundleVersion:string;modelBundleSha256:string;preprocessingVersion:string;members:KinectMember[];inferenceMs:number}
export type KinectSession={id:string;childId:string;deviceId:string;status:string;createdAt:string;child:{id:string;fullName:string};hasCapture:boolean;frameCount:number|null;trimStart:number|null;trimEnd:number|null;result:KinectResult|null;errorMessage:string|null;sourceSessionId?:string|null}
export type KinectCapture={captureId:string;sessionId:string;deviceId:string;jointNames:string[];xyz:number[][][];timestampsMs:number[];trackingState?:number[][];frameIndex?:number[]}
export type KinectDevice={id:string;name:string;connected:boolean;status?:{sensorAvailable:boolean;recording:boolean;frames:number;remoteControlEnabled:boolean}}
export type KinectPreview={xyz:number[][];jointNames:string[];trackingState?:number[]}

/** Technical labels (admin tools). */
export const KINECT_STATUS:Record<string,string>={READY:'Sẵn sàng',STARTING:'Đang yêu cầu ghi',RECORDING:'Đang ghi',STOPPING:'Đang yêu cầu dừng',AWAITING_CAPTURE:'Chờ trạm gửi bản ghi',REVIEW:'Sẵn sàng xem và cắt',QUEUED:'Đang chờ phân tích',PROCESSING:'Đang phân tích',COMPLETED:'Hoàn tất',FAILED:'Cần thử lại',CANCELED:'Đã hủy'}

/** Labels a parent sees. */
export const KINECT_PARENT_STATUS:Record<string,string>={READY:'Chuẩn bị ghi',STARTING:'Đang bật ghi',RECORDING:'Đang ghi',STOPPING:'Đang dừng',AWAITING_CAPTURE:'Đang nhận bản ghi',REVIEW:'Đã ghi xong',QUEUED:'Đang chờ phân tích',PROCESSING:'Đang phân tích',COMPLETED:'Có kết quả',FAILED:'Chưa thành công',CANCELED:'Đã hủy'}

export const KINECT_RECORDING_STATUSES=['STARTING','RECORDING','STOPPING','AWAITING_CAPTURE']
export const KINECT_ANALYZING_STATUSES=['QUEUED','PROCESSING']

const ERROR_TEXT:Record<string,string>={
 CONSENT_REQUIRED:'Cần xác nhận đồng ý của phụ huynh trước khi tiếp tục.',
 DEVICE_BUSY:'Trạm đang bận với một lượt ghi khác. Đợi lượt đó xong hoặc hủy nó rồi thử lại.',
 DEVICE_UNAVAILABLE:'Trạm chưa sẵn sàng. Kiểm tra app Kinect trên laptop và bật “Cho phép website điều khiển ghi”.',
 DEVICE_NOT_FOUND:'Không tìm thấy trạm này nữa. Tải lại trang và chọn trạm khác.',
 DEVICE_COMMAND_REJECTED:'Trạm từ chối lệnh ghi. Kiểm tra cảm biến trên laptop rồi ghi lại.',
 DEVICE_COMMAND_EXPIRED:'Trạm không phản hồi kịp. Kiểm tra kết nối mạng của laptop rồi ghi lại.',
 ANALYSIS_LOCKED:'Lượt này đã được gửi phân tích.',
 INVALID_TRIM:'Bản ghi quá ngắn. Hãy ghi lại, để trẻ đi vài bước trong vùng cảm biến.',
 CAPTURE_MISSING:'Không nhận được bản ghi từ trạm. Hãy ghi lại.',
 INVALID_CAPTURE:'Bản ghi chưa đủ rõ để phân tích (thiếu khớp hoặc quá ngắn). Hãy ghi lại, để cảm biến thấy trọn người trẻ.',
 MODEL_BUNDLE_MISMATCH:'Máy chủ phân tích đang được cập nhật. Vui lòng thử lại sau.',
 ML_UNAVAILABLE:'Máy chủ phân tích đang bận hoặc tạm ngưng. Hệ thống sẽ tự thử lại; bạn cũng có thể quay lại sau.',
 CHILD_NOT_FOUND:'Không tìm thấy hồ sơ trẻ.',
}
export function kinectErrorText(code:string|null|undefined,fallback='Chưa thực hiện được. Kiểm tra kết nối và thử lại.'){return (code&&ERROR_TEXT[code])||fallback}

/** What the station needs before it can record, in parent words; null when ready. */
export function kinectDeviceProblem(d:KinectDevice|undefined):string|null{
 if(!d)return 'Chưa có trạm Kinect nào được ghép với tài khoản.'
 if(!d.connected)return 'Trạm đang ngoại tuyến. Mở app Kinect trên laptop và kiểm tra mạng.'
 if(d.status&&!d.status.sensorAvailable)return 'Laptop chưa thấy cảm biến Kinect. Kiểm tra dây cắm và nguồn của cảm biến.'
 if(d.status&&!d.status.remoteControlEnabled)return 'Trong app Kinect, mở Tùy chọn trạm và bật “Cho phép website điều khiển ghi”.'
 return null
}

/** Kinect trackingState: 2 = tracked, 1 = inferred, 0 = not tracked. */
export function kinectTrackingQuality(p:KinectPreview|null){
 if(!p)return {visible:false,tracked:0,total:0,good:false}
 const total=p.jointNames.length
 const tracked=p.trackingState?p.trackingState.filter(s=>s===2).length:p.xyz.filter(v=>v.some(x=>x!==0)).length
 return {visible:true,tracked,total,good:total>0&&tracked>=total-3}
}
