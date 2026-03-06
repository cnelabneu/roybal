This is the website and code build for the Roybal pilot study on walking after TBI. 

Website is built in mongoDB and hosted on NEU's discovery cluster (might need to migrate to explorer) 

Website has two screens, one participant view, the other the staff view where new articipants can be added and intervention components can be added weekly. Twilio is integrated to send SMS or email reminders for intervention participants. 

Code also utilizes Fitbit's API to pull acitivty data from ongoing participants daily into a participant-specific csv (onto NEU discovery cluster) and awards points based on completed walks. 

https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=23RCXD&scope=activity+cardio_fitness+electrocardiogram+heartrate+location+nutrition+oxygen_saturation+profile+respiratory_rate+settings+sleep+social+temperature+weight&code_challenge=MAW4G5Jmci9QV7obCIdQshJMPKaD5jBaTQG07_TgNn4&code_challenge_method=S256&state=291q5l2z2m6l1b015l4j420d122o6o6h&redirect_uri=https%3A%2F%2Froybal.vercel.app%2Fauth%2Fcallback
