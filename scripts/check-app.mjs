import {AppClient} from '../bridge/app-client.mjs';
const app=new AppClient();try{const s=await app.status();console.log(JSON.stringify({connected:s.connected,mode:s.mode,plan:s.planType,models:s.models.map(m=>({model:m.slug,default:m.isDefault}))}));}finally{app.close();}
