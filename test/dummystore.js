//TODO: all of it :^)
// call this cas-really-poor, or casbroke.

function uuid4(a ?, b ?) {
	// from https://gist.github.com/LeverOne/1308368
	for(b=a='';a++<36;b+=a*51&52?(a^15?8^Math.random()*(a^20?16:4):4).toString(16):'-');
	return b;
}
